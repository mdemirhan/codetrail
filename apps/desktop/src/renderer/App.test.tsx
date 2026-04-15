// @vitest-environment jsdom

import { createClaudeHookStateFixture, createLiveStatusFixture } from "@codetrail/core/testing";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

const { copyTextToClipboard, openInFileManager, openPath } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
  openInFileManager: vi.fn(async () => ({ ok: true, error: null })),
  openPath: vi.fn(async () => ({ ok: true, error: null })),
}));

vi.mock("./lib/clipboard", () => ({
  copyTextToClipboard,
}));

vi.mock("./lib/pathActions", () => ({
  openInFileManager,
  openPath,
}));

import { App } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { formatInteger } from "./lib/numberFormatting";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import { createAppClient, installScrollIntoViewMock } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

function countChannelCalls(client: ReturnType<typeof createAppClient>, channel: string): number {
  return client.invoke.mock.calls.filter(([name]) => name === channel).length;
}

function fireKeyDownWithTimeStamp(
  target: Window | Document | Element,
  init: KeyboardEventInit & { key: string },
  timeStamp: number,
) {
  const event = new KeyboardEvent("keydown", init);
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
}

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

describe("App shell", () => {
  it("opens the dashboard view from the top bar and loads dashboard stats", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const user = userEvent.setup();

    renderWithClient(<App />, client);

    await user.click(screen.getByRole("button", { name: "Open dashboard" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Activity Dashboard" })).toBeInTheDocument();
    });

    expect(screen.getByText("Workspace telemetry")).toBeInTheDocument();
    expect(countChannelCalls(client, "dashboard:getStats")).toBeGreaterThanOrEqual(1);
  });

  it("refreshes dashboard stats when the dashboard is reopened", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const user = userEvent.setup();

    renderWithClient(<App />, client);

    await user.click(screen.getByRole("button", { name: "Open dashboard" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Activity Dashboard" })).toBeInTheDocument();
    });

    const firstOpenCalls = countChannelCalls(client, "dashboard:getStats");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Activity Dashboard" })).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Open dashboard" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Activity Dashboard" })).toBeInTheDocument();
      expect(countChannelCalls(client, "dashboard:getStats")).toBeGreaterThan(firstOpenCalls);
    });
  });

  it("compacts large message-type pill counts while keeping the exact count in the tooltip", async () => {
    installDialogMock();
    installScrollIntoViewMock();

    const client = createAppClient({
      "sessions:getDetail": () => ({
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
          messageCount: 18_457,
          bookmarkCount: 0,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
        totalCount: 18_457,
        categoryCounts: {
          user: 18_457,
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

    const { container } = renderWithClient(
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
      expect(
        screen.getByRole("button", {
          name: `Show or hide User messages (${formatInteger(18_457)})`,
        }),
      ).toBeInTheDocument();
    });

    expect(container.querySelector(".msg-filter.user-filter .filter-count")).toHaveTextContent(
      "18.5K",
    );
    expect(
      screen.getByRole("button", {
        name: `Show or hide User messages (${formatInteger(18_457)})`,
      }),
    ).toHaveAttribute(
      "title",
      `Show or hide User messages (${formatInteger(18_457)})  ⌘1\nCmd+Click Focus only User messages  ⌃1`,
    );
  });

  it("cmd-clicking a message filter pill focuses that category and restores on second cmd-click", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            historyCategories: ["user", "assistant", "tool_result"],
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    const userFilterButton = await screen.findByRole("button", {
      name: /Show or hide User messages \([\d,]+\)/,
    });

    fireEvent.click(userFilterButton, { metaKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
    });

    fireEvent.click(userFilterButton, { metaKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
    });
  });

  it("uses plain preset toggles for Cmd shortcuts and reversible focus for Ctrl shortcuts", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            historyCategories: ["user", "assistant", "tool_result"],
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "8", code: "Digit8", metaKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "8", code: "Digit8", metaKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "8", code: "Digit8", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "8", code: "Digit8", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "9", code: "Digit9", metaKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.thinking-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.system-filter")).toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "9", code: "Digit9", metaKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.thinking-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.system-filter")).not.toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "9", code: "Digit9", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.thinking-filter")).toHaveClass("active");
      expect(container.querySelector(".msg-filter.system-filter")).toHaveClass("active");
    });

    fireEvent.keyDown(window, { key: "9", code: "Digit9", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".msg-filter.user-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.assistant-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_edit-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_result-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.tool_use-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.thinking-filter")).not.toHaveClass("active");
      expect(container.querySelector(".msg-filter.system-filter")).not.toHaveClass("active");
    });
  });

  it("Cmd+E cycles visible items without changing the underlying default expansion state", async () => {
    installScrollIntoViewMock();

    const listeners: Array<(command: string) => void> = [];
    const client = createAppClient();
    client.onAppCommand.mockImplementation((listener) => {
      listeners.push(listener as (command: string) => void);
      return () => undefined;
    });
    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            historyCategories: ["user", "assistant"],
            expandedByDefaultCategories: ["user", "assistant"],
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Collapse shown items/i })).toBeInTheDocument();
    expect(
      container.querySelector(".msg-filter.user-filter .filter-expand-chevron"),
    ).not.toHaveClass("is-collapsed");
    expect(
      container.querySelector(".msg-filter.assistant-filter .filter-expand-chevron"),
    ).not.toHaveClass("is-collapsed");

    await act(async () => {
      for (const listener of listeners) {
        listener("toggle-all-messages-expanded");
      }
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Restore shown items",
        }),
      ).toBeInTheDocument();
    });
    expect(container.querySelectorAll(".message.expanded")).toHaveLength(0);
  });

  it("loads history, supports global search navigation, and opens settings", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient();

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            expandedByDefaultCategories: ["user", "assistant"],
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByText("markdown table rendering"));
    await waitFor(() => {
      expect(screen.getAllByText("Investigate markdown rendering").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(container.querySelector(".all-sessions-item.active")).toHaveTextContent(
        "All Sessions",
      );
    });
    expect(container.querySelector(".session-item:not(.all-sessions-item).active")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(container.querySelector(".msg-scroll.message-list"));
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    });
  });

  it("closes the search project menu with Escape without leaving search", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "All projects" }));
    await waitFor(() => {
      expect(screen.getByRole("menu", { name: "Projects" })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Projects" })).toBeNull();
      expect(container.querySelector(".search-view")).not.toBeNull();
      expect(screen.getByRole("button", { name: "All projects" })).toHaveFocus();
    });
  });

  it("defaults session message sorting to newest first", async () => {
    const client = createAppClient();

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

    expect(
      screen.getByRole("button", {
        name: "Newest first (session). Switch to oldest first",
      }),
    ).toBeInTheDocument();
  });

  it("shows a compact live session row in the message pane for the selected session", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "watcher:getLiveStatus": () =>
        createLiveStatusFixture({
          enabled: true,
          providerCounts: {
            claude: 1,
            codex: 0,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
            opencode: 0,
          },
          sessions: [
            {
              provider: "claude",
              sessionIdentity: "live-session-1",
              sourceSessionId: "provider-session-1",
              filePath: "/workspace/project-one/session-1.jsonl",
              projectName: "Project One",
              projectPath: "/workspace/project-one",
              cwd: "/workspace/project-one",
              statusKind: "waiting_for_input",
              statusText: "Waiting for input",
              detailText: "updating topbar layout",
              sourcePrecision: "hook",
              lastActivityAt: new Date(Date.now() - 12_000).toISOString(),
              bestEffort: false,
            },
          ],
          claudeHookState: createClaudeHookStateFixture({
            logPath: "/tmp/claude-hooks.jsonl",
            installed: true,
            managedEventNames: [],
            missingEventNames: [],
          }),
        }),
    });

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            liveWatchEnabled: true,
            preferredAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Watch (1s debounce)" }));

    await waitFor(() => {
      const liveRow = container.querySelector<HTMLElement>(".msg-live-row");
      expect(liveRow).not.toBeNull();
      expect(liveRow).toHaveTextContent("Live");
      expect(liveRow).toHaveTextContent("Waiting for input");
      expect(liveRow).toHaveTextContent("updating topbar layout");
      expect(liveRow).toHaveTextContent(/\d{2}s ago/);
    });
  });

  it("does not invoke live UI trace IPC when live instrumentation is disabled", async () => {
    installScrollIntoViewMock();

    const debugTraceHandler = vi.fn(() => ({ ok: true }));
    const client = createAppClient({
      "watcher:getLiveStatus": () =>
        createLiveStatusFixture({
          enabled: true,
          instrumentationEnabled: false,
          providerCounts: {
            claude: 1,
            codex: 0,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
            opencode: 0,
          },
          sessions: [
            {
              provider: "claude",
              sessionIdentity: "live-session-1",
              sourceSessionId: "provider-session-1",
              filePath: "/workspace/project-one/session-1.jsonl",
              projectName: "Project One",
              projectPath: "/workspace/project-one",
              cwd: "/workspace/project-one",
              statusKind: "waiting_for_input",
              statusText: "Waiting for input",
              detailText: "updating topbar layout",
              sourcePrecision: "hook",
              lastActivityAt: new Date(Date.now() - 12_000).toISOString(),
              bestEffort: false,
            },
          ],
          claudeHookState: createClaudeHookStateFixture({
            logPath: "/tmp/claude-hooks.jsonl",
            installed: true,
            managedEventNames: [],
            missingEventNames: [],
          }),
        }),
      "debug:recordLiveUiTrace": debugTraceHandler,
    });

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            liveWatchEnabled: true,
            preferredAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    expect(debugTraceHandler).not.toHaveBeenCalled();
  });

  it("renders the flat live row style when the background preference is disabled", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "watcher:getLiveStatus": () =>
        createLiveStatusFixture({
          enabled: true,
          providerCounts: {
            claude: 1,
            codex: 0,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
            opencode: 0,
          },
          sessions: [
            {
              provider: "claude",
              sessionIdentity: "live-session-1",
              sourceSessionId: "provider-session-1",
              filePath: "/workspace/project-one/session-1.jsonl",
              projectName: "Project One",
              projectPath: "/workspace/project-one",
              cwd: "/workspace/project-one",
              statusKind: "working",
              statusText: "Working",
              detailText: "updating styles",
              sourcePrecision: "hook",
              lastActivityAt: new Date(Date.now() - 12_000).toISOString(),
              bestEffort: false,
            },
          ],
          claudeHookState: createClaudeHookStateFixture({
            logPath: "/tmp/claude-hooks.jsonl",
            installed: true,
            managedEventNames: [],
            missingEventNames: [],
          }),
        }),
    });

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            liveWatchEnabled: true,
            liveWatchRowHasBackground: false,
            preferredAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Watch (1s debounce)" }));

    await waitFor(() => {
      expect(container.querySelector(".msg-live-row.is-flat")).not.toBeNull();
    });
  });

  it("applies the message-type auto-expand pill immediately and clears current-page manual overrides for that type", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "sessions:getDetail": () => ({
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
          user: 0,
          assistant: 0,
          tool_use: 2,
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
            id: "tool_1",
            sourceId: "tool_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "tool_use",
            content: JSON.stringify({
              tool_name: "Read",
              input: { file_path: "/workspace/project-one/src/app.ts" },
            }),
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
          {
            id: "tool_2",
            sourceId: "tool_src_2",
            sessionId: "session_1",
            provider: "claude",
            category: "tool_use",
            content: JSON.stringify({
              tool_name: "Write",
              input: { file_path: "/workspace/project-one/src/app.ts" },
            }),
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        ],
      }),
    });

    const { container } = renderWithClient(
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

    const toolUseExpandToggle = () =>
      container.querySelector<HTMLButtonElement>(
        ".msg-filter.tool_use-filter .msg-filter-expand-toggle",
      );

    await waitFor(() => {
      expect(toolUseExpandToggle()).not.toBeNull();
    });
    expect(container.querySelectorAll(".message.category-tool_use.expanded")).toHaveLength(0);

    await user.click(toolUseExpandToggle()!);
    await waitFor(() => {
      expect(container.querySelectorAll(".message.category-tool_use.expanded")).toHaveLength(2);
    });

    await user.click(screen.getAllByRole("button", { name: "Collapse message" })[0]!);
    expect(container.querySelectorAll(".message.category-tool_use.expanded")).toHaveLength(1);

    await user.click(toolUseExpandToggle()!);
    await user.click(toolUseExpandToggle()!);

    await waitFor(() => {
      expect(container.querySelectorAll(".message.category-tool_use.expanded")).toHaveLength(2);
    });
  });

  it("uses the toolbar expand and collapse button to align all message types with the shared default-expansion model", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "sessions:getDetail": () => ({
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
          messageCount: 3,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
        totalCount: 3,
        categoryCounts: {
          user: 1,
          assistant: 2,
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
            id: "user_1",
            sourceId: "user_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "user",
            content: "User body",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
          {
            id: "assistant_1",
            sourceId: "assistant_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "First assistant body",
            createdAt: "2026-03-01T10:00:02.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
          {
            id: "assistant_2",
            sourceId: "assistant_src_2",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "Second assistant body",
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        ],
      }),
    });

    const { container } = renderWithClient(
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
      expect(screen.getByText("User body")).toBeInTheDocument();
      expect(screen.getByText("First assistant body")).toBeInTheDocument();
      expect(screen.getByText("Second assistant body")).toBeInTheDocument();
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(3);
      expect(screen.getByRole("button", { name: /Collapse shown items/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Collapse shown items/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Restore shown items" })).toBeInTheDocument();
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(0);
    });

    await user.click(screen.getByRole("button", { name: "Restore shown items" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand shown items" })).toBeInTheDocument();
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(3);
    });

    await user.click(screen.getAllByRole("button", { name: "Collapse message" })[0]!);
    expect(container.querySelectorAll(".message.expanded")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /shown items/i }));
    await waitFor(() => {
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(3);
    });
  });

  it("Cmd+click on a message header toggles all visible messages of the same type", async () => {
    installScrollIntoViewMock();

    const client = createAppClient({
      "sessions:getDetail": () => ({
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
          messageCount: 3,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
        totalCount: 3,
        categoryCounts: {
          user: 1,
          assistant: 2,
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
            id: "assistant_1",
            sourceId: "assistant_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "First assistant body",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
          {
            id: "assistant_2",
            sourceId: "assistant_src_2",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "Second assistant body",
            createdAt: "2026-03-01T10:00:02.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
          {
            id: "user_1",
            sourceId: "user_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "user",
            content: "User body",
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        ],
      }),
    });

    const { container } = renderWithClient(
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
      expect(screen.getByText("First assistant body")).toBeInTheDocument();
      expect(screen.getByText("Second assistant body")).toBeInTheDocument();
      expect(screen.getByText("User body")).toBeInTheDocument();
    });

    const assistantHeader = container.querySelector<HTMLElement>(
      ".message.category-assistant .message-header",
    );
    expect(assistantHeader).not.toBeNull();
    fireEvent.click(assistantHeader!, { metaKey: true });

    await waitFor(() => {
      expect(container.querySelectorAll(".message.category-assistant.expanded")).toHaveLength(0);
    });
    expect(container.querySelectorAll(".message.category-user.expanded")).toHaveLength(1);
  });

  it("clears message expansion overrides when navigating away from the loaded page", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "sessions:getDetail": (request) => {
        const page = typeof request === "object" && request && "page" in request ? request.page : 0;
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
            messageCount: 4,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
          totalCount: 4,
          categoryCounts: {
            user: 0,
            assistant: 4,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: typeof page === "number" ? page : 0,
          pageSize: 2,
          focusIndex: null,
          messages:
            page === 0
              ? [
                  {
                    id: "assistant_1",
                    sourceId: "assistant_src_1",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "First assistant body",
                    createdAt: "2026-03-01T10:00:00.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                  {
                    id: "assistant_2",
                    sourceId: "assistant_src_2",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "Second assistant body",
                    createdAt: "2026-03-01T10:00:02.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                ]
              : [
                  {
                    id: "assistant_3",
                    sourceId: "assistant_src_3",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "Third assistant body",
                    createdAt: "2026-03-01T10:00:04.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                  {
                    id: "assistant_4",
                    sourceId: "assistant_src_4",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "Fourth assistant body",
                    createdAt: "2026-03-01T10:00:06.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                ],
        };
      },
    });

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            messagePageSize: 2,
          } as unknown as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("First assistant body")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    });

    await user.click(screen.getAllByRole("button", { name: "Collapse message" })[0]!);
    expect(container.querySelectorAll(".message.category-assistant.expanded")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText("Third assistant body")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => {
      expect(screen.getByText("First assistant body")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    });

    expect(container.querySelectorAll(".message.category-assistant.expanded")).toHaveLength(2);
  });

  it("keeps footer paging controls focused on messages and only commits page input on Enter", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "sessions:getDetail": (request) => {
        const page = typeof request === "object" && request && "page" in request ? request.page : 0;
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
            messageCount: 4,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
          totalCount: 4,
          categoryCounts: {
            user: 0,
            assistant: 4,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: typeof page === "number" ? page : 0,
          pageSize: 2,
          focusIndex: null,
          messages:
            page === 0
              ? [
                  {
                    id: "assistant_1",
                    sourceId: "assistant_src_1",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "First assistant body",
                    createdAt: "2026-03-01T10:00:00.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                  {
                    id: "assistant_2",
                    sourceId: "assistant_src_2",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "Second assistant body",
                    createdAt: "2026-03-01T10:00:02.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                ]
              : [
                  {
                    id: "assistant_3",
                    sourceId: "assistant_src_3",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "Third assistant body",
                    createdAt: "2026-03-01T10:00:04.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                  {
                    id: "assistant_4",
                    sourceId: "assistant_src_4",
                    sessionId: "session_1",
                    provider: "claude",
                    category: "assistant",
                    content: "Fourth assistant body",
                    createdAt: "2026-03-01T10:00:06.000Z",
                    tokenInput: null,
                    tokenOutput: null,
                    operationDurationMs: null,
                    operationDurationSource: null,
                    operationDurationConfidence: null,
                  },
                ],
        };
      },
    });

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            messagePageSize: 2,
          } as unknown as PaneStateSnapshot
        }
      />,
      client,
    );

    const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
    const footer = container.querySelector<HTMLDivElement>(".msg-pagination");

    await waitFor(() => {
      expect(screen.getByText("First assistant body")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    });

    expect(messageList).not.toBeNull();
    expect(footer).not.toBeNull();

    messageList?.focus();
    expect(document.activeElement).toBe(messageList);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
    expect(document.activeElement).toBe(messageList);

    fireEvent.mouseDown(footer!);
    expect(document.activeElement).toBe(messageList);

    const pageInput = screen.getByRole("textbox", { name: "Page number" });

    await user.click(pageInput);
    await user.clear(pageInput);
    await user.type(pageInput, "1");
    await user.keyboard("{Tab}");
    expect(pageInput).toHaveValue("2");
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Messages per page" }),
    );

    await user.click(pageInput);
    await user.clear(pageInput);
    await user.type(pageInput, "1");
    await user.keyboard("{Escape}");
    expect(pageInput).toHaveValue("2");
    expect(document.activeElement).toBe(messageList);

    await user.click(pageInput);
    await user.clear(pageInput);
    await user.type(pageInput, "1{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
      expect(screen.getByText("First assistant body")).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(messageList);
  });

  it("does not show a project-level live row while viewing a different session", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "watcher:getLiveStatus": () =>
        createLiveStatusFixture({
          enabled: true,
          providerCounts: {
            claude: 1,
            codex: 0,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
            opencode: 0,
          },
          sessions: [
            {
              provider: "claude",
              sessionIdentity: "other-live-session",
              sourceSessionId: "provider-session-2",
              filePath: "/workspace/project-one/session-2.jsonl",
              projectName: "Project One",
              projectPath: "/workspace/project-one",
              cwd: "/workspace/project-one",
              statusKind: "working",
              statusText: "Responding",
              detailText: "working in another session",
              sourcePrecision: "hook",
              lastActivityAt: new Date(Date.now() - 12_000).toISOString(),
              bestEffort: false,
            },
          ],
          claudeHookState: createClaudeHookStateFixture({
            logPath: "/tmp/claude-hooks.jsonl",
            installed: true,
            managedEventNames: [],
            missingEventNames: [],
          }),
        }),
    });

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            liveWatchEnabled: true,
            preferredAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Watch (1s debounce)" }));

    await waitFor(() => {
      expect(container.querySelector(".msg-live-row")).toBeNull();
    });
  });

  it("flushes app state when settings closes", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    expect(
      client.invoke.mock.calls.filter(([channel]) => channel === "app:flushState"),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    });

    expect(
      client.invoke.mock.calls.filter(([channel]) => channel === "app:flushState"),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Return to history view" }));

    await waitFor(() => {
      expect(
        client.invoke.mock.calls.filter(([channel]) => channel === "app:flushState"),
      ).toHaveLength(1);
    });
  });

  it("routes Cmd+Left/Right to history and global search pagination", async () => {
    const user = userEvent.setup();
    const client = createAppClient({
      "sessions:getDetail": (request) => {
        const requestedPage = Number(request.page ?? 0);
        const page = Number.isFinite(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
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
            messageCount: 250,
            bookmarkCount: 0,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
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
          page,
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
      },
    });

    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
      expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    });

    const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
    expect(messageList).not.toBeNull();
    if (!messageList) {
      throw new Error("Expected message list");
    }
    messageList.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(messageList);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    });
    await waitFor(() => {
      expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(([channel]) => channel === "search:query");
      expect(calls.some(([, payload]) => (payload as { offset?: number }).offset === 100)).toBe(
        true,
      );
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    });
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });
  });

  it("shows Turns view and paginates turns using the current sort order", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    const { container } = renderWithClient(
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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "t", metaKey: true });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("2 of 2 turn messages")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Messages per page" })).toBeNull();
      expect(screen.getByText("Review the latest turn")).toBeInTheDocument();
    });

    const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
    messageList?.focus();

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Previous turn" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("Review the latest turn")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("combobox", { name: "Messages per page" })).toBeInTheDocument();
    });
  });

  it("uses double Escape in the message pane to reset Turns search without leaving Turns view", async () => {
    const client = createAppClient();
    const { container } = renderWithClient(
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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
    });
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search current history view" }),
      "latest",
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });

    const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
    messageList?.focus();

    await act(async () => {
      fireKeyDownWithTimeStamp(window, { key: "Escape" }, 100);
      fireKeyDownWithTimeStamp(window, { key: "Escape" }, 200);
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Search current history view" })).toHaveValue("");
      expect(screen.queryByRole("combobox", { name: "Messages per page" })).toBeNull();
    });
  });

  it("uses double Escape from another history pane to reset Turns search without leaving Turns view", async () => {
    const client = createAppClient();
    const { container } = renderWithClient(
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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
    });
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search current history view" }),
      "review",
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });

    const projectPane = container.querySelector<HTMLElement>('[data-history-pane="project"]');
    projectPane?.focus();

    await act(async () => {
      fireKeyDownWithTimeStamp(window, { key: "Escape" }, 100);
      fireKeyDownWithTimeStamp(window, { key: "Escape" }, 200);
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Search current history view" })).toHaveValue("");
    });
  });

  it("opens the oldest turn on page 1 when Turn View sort is oldest first", async () => {
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            turnViewSortDirection: "asc",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });
  });

  it("shows the Turns visualization in project-all mode and opens it with Cmd+T", async () => {
    const client = createAppClient();

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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
    });
  });

  it("restores the last viewed turn when switching back from Messages in the same scope", async () => {
    const client = createAppClient();

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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
    });

    const rememberedTurnMessageList = document.querySelector<HTMLDivElement>(
      ".msg-scroll.message-list",
    );
    expect(rememberedTurnMessageList).not.toBeNull();
    if (!rememberedTurnMessageList) {
      throw new Error("Expected message list");
    }
    rememberedTurnMessageList.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(rememberedTurnMessageList);
    });

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });
  });

  it("resets the remembered turn when the history scope changes", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
    });

    const resetRememberedTurnMessageList = document.querySelector<HTMLDivElement>(
      ".msg-scroll.message-list",
    );
    expect(resetRememberedTurnMessageList).not.toBeNull();
    if (!resetRememberedTurnMessageList) {
      throw new Error("Expected message list");
    }
    resetRememberedTurnMessageList.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(resetRememberedTurnMessageList);
    });

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
    });

    await user.click(screen.getByRole("button", { name: /All Sessions/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("Review the latest turn")).toBeInTheDocument();
    });
  });

  it("recovers from stale turn anchors when switching projects in Turns view", async () => {
    const user = userEvent.setup();
    type TurnFixture = {
      anchorMessageId: string;
      sessionId: string;
      messages: Array<{
        id: string;
        sourceId: string;
        sessionId: string;
        provider: "claude" | "codex";
        category: "user" | "assistant";
        content: string;
        createdAt: string;
        tokenInput: number | null;
        tokenOutput: number | null;
        operationDurationMs: number | null;
        operationDurationSource: "native" | null;
        operationDurationConfidence: "high" | null;
      }>;
    };

    const projectTurns: Record<"project_1" | "project_2", TurnFixture[]> = {
      project_1: [
        {
          anchorMessageId: "p1_turn_1",
          sessionId: "session_1",
          messages: [
            {
              id: "p1_turn_1",
              sourceId: "src_p1_turn_1",
              sessionId: "session_1",
              provider: "claude",
              category: "user",
              content: "Project One latest turn",
              createdAt: "2026-03-01T10:00:06.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
            },
            {
              id: "p1_turn_1_reply",
              sourceId: "src_p1_turn_1_reply",
              sessionId: "session_1",
              provider: "claude",
              category: "assistant",
              content: "Project One latest reply",
              createdAt: "2026-03-01T10:00:07.000Z",
              tokenInput: 8,
              tokenOutput: 5,
              operationDurationMs: 1000,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            },
          ],
        },
        {
          anchorMessageId: "p1_turn_2",
          sessionId: "session_1",
          messages: [
            {
              id: "p1_turn_2",
              sourceId: "src_p1_turn_2",
              sessionId: "session_1",
              provider: "claude",
              category: "user",
              content: "Project One oldest turn",
              createdAt: "2026-03-01T10:00:00.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
            },
            {
              id: "p1_turn_2_reply",
              sourceId: "src_p1_turn_2_reply",
              sessionId: "session_1",
              provider: "claude",
              category: "assistant",
              content: "Project One oldest reply",
              createdAt: "2026-03-01T10:00:01.000Z",
              tokenInput: 6,
              tokenOutput: 4,
              operationDurationMs: 1000,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            },
          ],
        },
      ],
      project_2: [
        {
          anchorMessageId: "p2_turn_1",
          sessionId: "session_2",
          messages: [
            {
              id: "p2_turn_1",
              sourceId: "src_p2_turn_1",
              sessionId: "session_2",
              provider: "codex",
              category: "user",
              content: "Project Two latest turn",
              createdAt: "2026-03-01T11:00:00.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
            },
            {
              id: "p2_turn_1_reply",
              sourceId: "src_p2_turn_1_reply",
              sessionId: "session_2",
              provider: "codex",
              category: "assistant",
              content: "Project Two latest reply",
              createdAt: "2026-03-01T11:00:01.000Z",
              tokenInput: 7,
              tokenOutput: 4,
              operationDurationMs: 1000,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            },
          ],
        },
      ],
    };
    const categoryCounts = {
      user: 1,
      assistant: 1,
      tool_use: 0,
      tool_edit: 0,
      tool_result: 0,
      thinking: 0,
      system: 0,
    } as const;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 4,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:00:07.000Z",
          },
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 2,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T11:00:01.000Z",
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
            title: "Project One session",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:07.000Z",
            durationMs: 7000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: 4,
            bookmarkCount: 0,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
          {
            id: "session_2",
            projectId: "project_2",
            provider: "codex",
            filePath: "/workspace/project-two/session-1.jsonl",
            title: "Project Two session",
            modelNames: "gpt-5.4",
            startedAt: "2026-03-01T11:00:00.000Z",
            endedAt: "2026-03-01T11:00:01.000Z",
            durationMs: 1000,
            gitBranch: "main",
            cwd: "/workspace/project-two",
            messageCount: 2,
            bookmarkCount: 0,
            tokenInputTotal: 7,
            tokenOutputTotal: 4,
          },
        ],
      }),
      "projects:getCombinedDetail": (request) => {
        const projectId = String(request.projectId ?? "project_1") as keyof typeof projectTurns;
        const latestTurn = projectTurns[projectId][0]!;
        return {
          projectId,
          totalCount: latestTurn.messages.length,
          categoryCounts,
          page: 0,
          pageSize: 100,
          focusIndex: null,
          messages: latestTurn.messages.map((message) => ({
            ...message,
            sessionTitle: projectId === "project_1" ? "Project One session" : "Project Two session",
            sessionActivity:
              latestTurn.messages.at(-1)?.createdAt ?? latestTurn.messages[0]!.createdAt,
            sessionStartedAt: latestTurn.messages[0]!.createdAt,
            sessionEndedAt:
              latestTurn.messages.at(-1)?.createdAt ?? latestTurn.messages[0]!.createdAt,
            sessionGitBranch: "main",
            sessionCwd:
              projectId === "project_1" ? "/workspace/project-one" : "/workspace/project-two",
          })),
        };
      },
      "sessions:getTurn": (request) => {
        const projectId = String(request.projectId ?? "project_1") as keyof typeof projectTurns;
        const turns = projectTurns[projectId];
        const requestedAnchorMessageId =
          typeof request.anchorMessageId === "string" && request.anchorMessageId.length > 0
            ? request.anchorMessageId
            : null;
        const requestedTurnNumber =
          typeof request.turnNumber === "number" ? Math.trunc(request.turnNumber) : null;
        const turnIndex =
          request.latest === true
            ? 0
            : requestedTurnNumber !== null
              ? requestedTurnNumber - 1
              : requestedAnchorMessageId
                ? turns.findIndex((turn) => turn.anchorMessageId === requestedAnchorMessageId)
                : -1;

        if (turnIndex < 0 || turnIndex >= turns.length) {
          return {
            session: {
              id: projectId === "project_1" ? "session_1" : "session_2",
              projectId,
              provider: projectId === "project_1" ? "claude" : "codex",
              filePath:
                projectId === "project_1"
                  ? "/workspace/project-one/session-1.jsonl"
                  : "/workspace/project-two/session-1.jsonl",
              title: projectId === "project_1" ? "Project One session" : "Project Two session",
              modelNames: projectId === "project_1" ? "claude-opus-4-1" : "gpt-5.4",
              startedAt: null,
              endedAt: null,
              durationMs: 0,
              gitBranch: "main",
              cwd: projectId === "project_1" ? "/workspace/project-one" : "/workspace/project-two",
              messageCount: turns.flatMap((turn) => turn.messages).length,
              tokenInputTotal: 0,
              tokenOutputTotal: 0,
            },
            anchorMessageId: null,
            anchorMessage: null,
            turnNumber: 0,
            totalTurns: turns.length,
            previousTurnAnchorMessageId: null,
            nextTurnAnchorMessageId: null,
            firstTurnAnchorMessageId: turns.at(-1)?.anchorMessageId ?? null,
            latestTurnAnchorMessageId: turns[0]?.anchorMessageId ?? null,
            totalCount: 0,
            categoryCounts,
            queryError: null,
            highlightPatterns: [],
            matchedMessageIds: undefined,
            messages: [],
          };
        }

        const turn = turns[turnIndex]!;
        return {
          session: {
            id: turn.sessionId,
            projectId,
            provider: projectId === "project_1" ? "claude" : "codex",
            filePath:
              projectId === "project_1"
                ? "/workspace/project-one/session-1.jsonl"
                : "/workspace/project-two/session-1.jsonl",
            title: projectId === "project_1" ? "Project One session" : "Project Two session",
            modelNames: projectId === "project_1" ? "claude-opus-4-1" : "gpt-5.4",
            startedAt: turn.messages[0]!.createdAt,
            endedAt: turn.messages.at(-1)?.createdAt ?? turn.messages[0]!.createdAt,
            durationMs: 1000,
            gitBranch: "main",
            cwd: projectId === "project_1" ? "/workspace/project-one" : "/workspace/project-two",
            messageCount: turn.messages.length,
            tokenInputTotal: 0,
            tokenOutputTotal: 0,
          },
          anchorMessageId: turn.anchorMessageId,
          anchorMessage: turn.messages[0]!,
          turnNumber: turnIndex + 1,
          totalTurns: turns.length,
          previousTurnAnchorMessageId:
            turnIndex + 1 < turns.length ? turns[turnIndex + 1]!.anchorMessageId : null,
          nextTurnAnchorMessageId: turnIndex > 0 ? turns[turnIndex - 1]!.anchorMessageId : null,
          firstTurnAnchorMessageId: turns.at(-1)?.anchorMessageId ?? null,
          latestTurnAnchorMessageId: turns[0]?.anchorMessageId ?? null,
          totalCount: turn.messages.length,
          categoryCounts,
          queryError: null,
          highlightPatterns: [],
          matchedMessageIds: undefined,
          messages: turn.messages,
        };
      },
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
      expect(screen.getByRole("button", { name: /Project Two/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("Project One latest turn")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
      expect(screen.getByText("Project One oldest turn")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "/workspace/project-two, 1 projects" }));

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-project-nav-kind="project"][data-project-nav-id="project_2"]',
        ),
      ).not.toBeNull();
    });

    await user.click(
      document.querySelector('[data-project-nav-kind="project"][data-project-nav-id="project_2"]')!,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("Project Two latest turn")).toBeInTheDocument();
      expect(screen.getByText("2 of 2 turn messages")).toBeInTheDocument();
      expect(screen.getByText("of 1")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Previous turn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next turn" })).toBeDisabled();
    expect(
      client.invoke.mock.calls.some(
        ([channel, payload]) =>
          channel === "sessions:getTurn" &&
          (payload as { projectId?: string; anchorMessageId?: string }).projectId === "project_2" &&
          (payload as { anchorMessageId?: string }).anchorMessageId === "p1_turn_2",
      ),
    ).toBe(true);
  });

  it("treats Turns as a peer visualization when switching from Bookmarks", async () => {
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            historyMode: "bookmarks",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Bookmarks/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: /Bookmarks/i })).toHaveAttribute(
        "aria-selected",
        "false",
      );
      expect(screen.getByRole("textbox", { name: "Turn number" })).toBeInTheDocument();
    });
  });

  it("shows direct and cycle shortcuts in the Messages and Turns tooltips", async () => {
    const client = createAppClient();

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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute(
      "title",
      "Flat: all messages in order  ⌘⇧M • Cycle: ⌘T",
    );
    expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute(
      "title",
      "Turns: grouped by user turns  ⌘⇧T • Cycle: ⌘T",
    );
  });

  it("reveals assistant messages in Turn view and keeps the message focused", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();

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

    let assistantMessageCard: HTMLElement | null = null;
    await waitFor(() => {
      assistantMessageCard = screen.getByText("Everything checks out.").closest("article");
      expect(assistantMessageCard).not.toBeNull();
    });
    if (!assistantMessageCard) {
      throw new Error("Expected assistant message card");
    }

    await user.click(
      within(assistantMessageCard).getByRole("button", { name: "Reveal this message in turn" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
    });

    await waitFor(() => {
      const focusedTurnCard = screen.getByText("Everything checks out.").closest("article");
      expect(focusedTurnCard).not.toBeNull();
      expect(focusedTurnCard).toHaveClass("focused");
    });

    const focusedTurnCard = screen.getByText("Everything checks out.").closest("article");
    if (!focusedTurnCard) {
      throw new Error("Expected focused turn card");
    }

    await user.click(
      within(focusedTurnCard).getByRole("button", { name: "Reveal this message in session" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
    });

    await waitFor(() => {
      const focusedMessageCard = screen.getByText("Everything checks out.").closest("article");
      expect(focusedMessageCard).not.toBeNull();
      expect(focusedMessageCard).toHaveClass("focused");
    });
  });

  it("exits Turn view before revealing a message in the project view", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();

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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
    });

    let assistantTurnCard: HTMLElement | null = null;
    await waitFor(() => {
      assistantTurnCard = screen.getByText("Latest turn reply").closest("article");
      expect(assistantTurnCard).not.toBeNull();
    });
    if (!assistantTurnCard) {
      throw new Error("Expected assistant turn card");
    }

    await user.click(
      within(assistantTurnCard).getByRole("button", { name: "Reveal this message in project" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("button", { name: /first \(all sessions\)\. switch to/i }),
      ).toBeInTheDocument();
    });
  });

  it("preserves the combined changes expansion preference when toggling Turn View off and on", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            turnViewCombinedChangesExpanded: true,
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("button", { name: /collapse combined changes/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /collapse combined changes/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /expand combined changes/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("button", { name: /expand combined changes/i })).toBeInTheDocument();
    });
  });

  it("stays in Turn View when switching back to project-all history", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

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
      expect(screen.getByRole("tab", { name: /Turns/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
    });

    await user.click(screen.getByRole("button", { name: /All Sessions/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Turns/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: "Turn number" })).toBeInTheDocument();
    });
  });

  it("shows generic pagination shortcuts in help page", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open help" }));

    expect(screen.getByText("Previous page / turn")).toBeInTheDocument();
    expect(screen.getByText("Next page / turn")).toBeInTheDocument();
    expect(screen.getByText("Turns view")).toBeInTheDocument();
    expect(screen.getByText("Previous session / project")).toBeInTheDocument();
    expect(screen.getByText("Next session / project")).toBeInTheDocument();
  });

  it("stores pane widths in CSS variables instead of inline grid columns", async () => {
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    const workspace = container.querySelector<HTMLElement>(".workspace.history-layout");
    expect(workspace).not.toBeNull();
    if (!workspace) {
      throw new Error("Expected history workspace");
    }

    expect(workspace.style.gridTemplateColumns).toBe("");
    expect(workspace.style.getPropertyValue("--project-pane-width")).toBe("300px");
    expect(workspace.style.getPropertyValue("--session-pane-width")).toBe("36px");
  });

  it("hides disabled provider toggles and projects", async () => {
    installScrollIntoViewMock();
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
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 1,
            lastActivity: "2026-03-01T10:00:06.000Z",
          },
        ],
      }),
    });

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            enabledProviders: ["claude"],
            projectProviders: ["claude"],
            searchProviders: ["claude"],
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    expect(screen.queryByText("Project Two")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /Codex/i })).toHaveLength(0);
  });

  it("requires confirmation before disabling a provider", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const client = createAppClient();

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
            projectProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
            searchProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Providers" })).toBeInTheDocument();
    });

    const codexCheckbox = screen.getByRole("checkbox", { name: "Codex" });
    expect(codexCheckbox).toBeChecked();

    await user.click(codexCheckbox);
    expect(screen.getByText("Disable Codex?")).toBeInTheDocument();
    expect(
      screen.getByText(/will delete all indexed sessions and all bookmarks for that provider/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(codexCheckbox).toBeChecked();

    await user.click(codexCheckbox);
    await user.click(screen.getByRole("button", { name: "Disable Provider" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Codex" })).not.toBeChecked();
    });
    await waitFor(() => {
      const indexerConfigCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:setConfig",
      );
      expect(
        indexerConfigCalls.some(([, payload]) => {
          const state = payload as { enabledProviders?: string[] };
          return (
            Array.isArray(state.enabledProviders) &&
            !state.enabledProviders.includes("codex") &&
            state.enabledProviders.includes("claude")
          );
        }),
      ).toBe(true);
    });
  });

  it("Escape closes the confirmation dialog before leaving settings", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Database Maintenance" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: "Codex" }));
    expect(screen.getByText("Disable Codex?")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Disable Codex?")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Database Maintenance" })).toBeInTheDocument();
  });

  it("requires confirmation before enabling missing session cleanup", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Database Maintenance" })).toBeInTheDocument();
    });

    const cleanupCheckbox = screen.getByRole("checkbox", {
      name: "Remove indexed sessions when source files disappear during incremental refresh",
    });
    expect(cleanupCheckbox).not.toBeChecked();

    await user.click(cleanupCheckbox);
    expect(screen.getByText("Enable Missing Session Cleanup?")).toBeInTheDocument();
    expect(
      screen.getByText(/incremental refreshes will delete indexed sessions whose raw transcript/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cleanupCheckbox).not.toBeChecked();

    await user.click(cleanupCheckbox);
    await user.click(screen.getByRole("button", { name: "Enable Cleanup" }));

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", {
          name: "Remove indexed sessions when source files disappear during incremental refresh",
        }),
      ).toBeChecked();
    });
    await waitFor(() => {
      const indexerConfigCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:setConfig",
      );
      expect(
        indexerConfigCalls.some(([, payload]) => {
          const state = payload as {
            removeMissingSessionsDuringIncrementalIndexing?: boolean;
          };
          return state.removeMissingSessionsDuringIncrementalIndexing === true;
        }),
      ).toBe(true);
    });
  });

  it("disables refresh and settings reindex controls while background indexing is active", async () => {
    const client = createAppClient({
      "indexer:getStatus": () => ({
        running: true,
        queuedJobs: 1,
        activeJobId: "refresh-1",
      }),
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Indexing in progress" })).toBeDisabled();
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Force reindex" })).toBeDisabled();
    });
  });

  it("requires confirmation before force reindex from settings", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Database Maintenance" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Force reindex" }));
    const forceReindexHeading = screen.getByRole("heading", { name: "Force Reindex" });
    const forceReindexDialog = forceReindexHeading.closest("dialog");
    expect(forceReindexDialog).not.toBeNull();
    if (!forceReindexDialog) {
      throw new Error("Expected force reindex dialog");
    }
    expect(
      within(forceReindexDialog).getByText(/they can disappear after this reindex/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Force reindex" }));
    await user.click(screen.getByRole("button", { name: "Reindex" }));

    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel, payload]) =>
          channel === "indexer:refresh" &&
          (payload as { force?: boolean; projectId?: string }).force === true &&
          !(payload as { projectId?: string }).projectId,
      );
      expect(refreshCalls.length).toBeGreaterThan(0);
    });
  });

  it("requires confirmation before project reindex from the project context menu", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /Project One/i }));
    await user.click(screen.getByRole("menuitem", { name: "Reindex Project…" }));

    expect(screen.getByRole("heading", { name: "Reindex Project" })).toBeInTheDocument();
    expect(screen.getByText(/rebuild indexed history for that project only/i)).toBeInTheDocument();
    expect(screen.getByText(/other projects are unaffected/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reindex Project" }));

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("indexer:refresh", {
        force: true,
        projectId: "project_1",
      });
    });
  });

  it("publishes selected-project reindex availability from the visible project selection", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("app:setCommandState", {
        canReindexSelectedProject: false,
      });
    });

    await user.click(screen.getByRole("button", { name: /Project One/i }));

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("app:setCommandState", {
        canReindexSelectedProject: true,
      });
    });
  });

  it("disables selected-project reindex when a folder row is focused in tree view", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("app:setCommandState", {
        canReindexSelectedProject: true,
      });
    });

    await user.click(screen.getByRole("button", { name: /project-one, 1 projects/i }));

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("app:setCommandState", {
        canReindexSelectedProject: false,
      });
    });
  });

  it("keeps project reindex available while watch refresh is active", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            currentAutoRefreshStrategy: "watch-1s",
            preferredAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /Project One/i }));

    expect(screen.getByRole("menuitem", { name: "Reindex Project…" })).toBeEnabled();
  });

  it("disables project reindex while background indexing is active", async () => {
    installScrollIntoViewMock();
    const client = createAppClient({
      "indexer:getStatus": () => ({
        running: true,
        queuedJobs: 1,
        activeJobId: "refresh-1",
      }),
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /Project One/i }));

    expect(screen.getByRole("menuitem", { name: "Reindex Project…" })).toBeDisabled();
  });

  it("opens the project reindex dialog from the app command for the selected project", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const listeners: Array<(command: string) => void> = [];
    const client = createAppClient();
    client.onAppCommand.mockImplementation((listener) => {
      listeners.push(listener as (command: string) => void);
      return () => undefined;
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Project One/i }));

    await act(async () => {
      listeners.at(-1)?.("reindex-selected-project");
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Reindex Project" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Reindex Project" }));

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("indexer:refresh", {
        force: true,
        projectId: "project_1",
      });
    });
  });

  it("ignores the project reindex app command outside the history view", async () => {
    installScrollIntoViewMock();
    installDialogMock();
    const user = userEvent.setup();
    const listeners: Array<(command: string) => void> = [];
    const client = createAppClient();
    client.onAppCommand.mockImplementation((listener) => {
      listeners.push(listener as (command: string) => void);
      return () => undefined;
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Database Maintenance" })).toBeInTheDocument();
    });

    await act(async () => {
      listeners.at(-1)?.("reindex-selected-project");
    });

    expect(screen.queryByRole("heading", { name: "Reindex Project" })).toBeNull();
  });

  it("restores the last selected auto-refresh mode with Cmd+Shift+R", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "10s scan" }));

    expect(screen.getByRole("button", { name: "Auto-refresh strategy" }).textContent).toContain(
      "10s scan",
    );

    fireEvent.keyDown(window, { key: "R", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Auto-refresh strategy" }).textContent).toContain(
        "Manual",
      );
    });

    fireEvent.keyDown(window, { key: "R", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Auto-refresh strategy" }).textContent).toContain(
        "10s scan",
      );
    });
  });

  it("hydrates the preferred auto-refresh mode without enabling it on startup", async () => {
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            projectPaneWidth: 300,
            sessionPaneWidth: 320,
            preferredAutoRefreshStrategy: "watch-3s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Auto-refresh strategy" }).textContent).toContain(
      "Manual",
    );

    fireEvent.keyDown(window, { key: "R", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Auto-refresh strategy" }).textContent).toContain(
        "Watch (3s debounce)",
      );
    });
  });

  it("starts watcher mode with the selected debounce", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Watch (1s debounce)" }));

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("watcher:start", { debounceMs: 1000 });
    });
  });

  it("restores active watch auto-refresh on startup", async () => {
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            projectPaneWidth: 300,
            sessionPaneWidth: 320,
            currentAutoRefreshStrategy: "watch-3s",
            preferredAutoRefreshStrategy: "watch-3s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Auto-refresh strategy" }).textContent).toContain(
        "Watch (3s debounce)",
      );
      expect(client.invoke).toHaveBeenCalledWith("watcher:start", { debounceMs: 3000 });
    });
  });

  it("refreshes live status immediately after watcher startup instead of waiting for the poll interval", async () => {
    installScrollIntoViewMock();

    let liveStatusCallCount = 0;
    const client = createAppClient({
      "watcher:getLiveStatus": () => {
        liveStatusCallCount += 1;
        if (liveStatusCallCount === 1) {
          return createLiveStatusFixture({
            enabled: true,
            revision: 1,
            providerCounts: {
              claude: 0,
              codex: 0,
              gemini: 0,
              cursor: 0,
              copilot: 0,
              copilot_cli: 0,
              opencode: 0,
            },
            sessions: [],
            claudeHookState: createClaudeHookStateFixture(),
          });
        }
        return createLiveStatusFixture({
          enabled: true,
          revision: 2,
          providerCounts: {
            claude: 1,
            codex: 0,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
            opencode: 0,
          },
          sessions: [
            {
              provider: "claude",
              sessionIdentity: "live-session-1",
              sourceSessionId: "provider-session-1",
              filePath: "/workspace/project-one/session-1.jsonl",
              projectName: "Project One",
              projectPath: "/workspace/project-one",
              cwd: "/workspace/project-one",
              statusKind: "working",
              statusText: "Working",
              detailText: "Seeded on startup",
              sourcePrecision: "passive",
              lastActivityAt: new Date(Date.now() - 4_000).toISOString(),
              bestEffort: false,
            },
          ],
          claudeHookState: createClaudeHookStateFixture(),
        });
      },
    });

    const { container } = renderWithClient(
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
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
      expect(container.querySelector(".msg-live-row")).not.toBeNull();
    });

    expect(container.querySelector(".msg-live-row")).toHaveTextContent("Seeded on startup");
    expect(liveStatusCallCount).toBeGreaterThanOrEqual(2);
    expect(client.invoke).toHaveBeenCalledWith("watcher:start", { debounceMs: 1000 });
  });

  it("does not get stuck on a stale startup live-status revision under StrictMode", async () => {
    installScrollIntoViewMock();

    let liveStatusCallCount = 0;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "codex",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
        ],
      }),
      "sessions:list": () => ({
        sessions: [
          {
            id: "session_1",
            projectId: "project_1",
            provider: "codex",
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Investigate markdown rendering",
            modelNames: "gpt-5",
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
      }),
      "watcher:getLiveStatus": () => {
        liveStatusCallCount += 1;
        if (liveStatusCallCount === 1) {
          return createLiveStatusFixture({
            enabled: false,
            revision: 1,
            providerCounts: {
              claude: 0,
              codex: 0,
              gemini: 0,
              cursor: 0,
              copilot: 0,
              copilot_cli: 0,
              opencode: 0,
            },
            sessions: [],
            claudeHookState: createClaudeHookStateFixture(),
          });
        }
        return createLiveStatusFixture({
          enabled: true,
          revision: 2,
          providerCounts: {
            claude: 0,
            codex: 1,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
            opencode: 0,
          },
          sessions: [
            {
              provider: "codex",
              sessionIdentity: "live-session-1",
              sourceSessionId: "provider-session-1",
              filePath: "/workspace/project-one/session-1.jsonl",
              projectName: "Project One",
              projectPath: "/workspace/project-one",
              cwd: "/workspace/project-one",
              statusKind: "idle",
              statusText: "Idle",
              detailText: "Detected on startup",
              sourcePrecision: "passive",
              lastActivityAt: new Date(Date.now() - 5_000).toISOString(),
              bestEffort: false,
            },
          ],
          claudeHookState: createClaudeHookStateFixture(),
        });
      },
    });

    const { container } = renderWithClient(
      <StrictMode>
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
        />
      </StrictMode>,
      client,
    );

    await waitFor(() => {
      expect(container.querySelector(".msg-live-row")).not.toBeNull();
    });

    expect(container.querySelector(".msg-live-row")).toHaveTextContent("Detected on startup");
    expect(liveStatusCallCount).toBeGreaterThanOrEqual(2);
  });

  it("sends watcher stop IPC on unmount when watch mode is active", async () => {
    const client = createAppClient();

    const { unmount } = renderWithClient(
      <App
        initialPaneState={
          {
            projectPaneWidth: 300,
            sessionPaneWidth: 320,
            currentAutoRefreshStrategy: "watch-3s",
            preferredAutoRefreshStrategy: "watch-3s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("watcher:start", { debounceMs: 3000 });
    });

    unmount();

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("watcher:stop", {});
    });
  });

  it("shows the watcher queue count on the auto-refresh control", async () => {
    const user = userEvent.setup();
    const client = createAppClient({
      "watcher:getStatus": () => ({
        running: true,
        processing: false,
        pendingPathCount: 2,
      }),
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Watch (1s debounce)" }));

    await waitFor(() => {
      expect(screen.getByTitle("Watcher queue: 2 files")).toHaveTextContent("2");
    });
  });

  it("passes per-mode message sort direction to detail requests and toggles on click", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Newest first (all sessions). Switch to oldest first",
        }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Newest first (all sessions). Switch to oldest first",
      }),
    );

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

  it("opens bookmarks from the message header and returns to the previous session view", async () => {
    const user = userEvent.setup();
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
            bookmarkCount: 3,
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
            bookmarkCount: 2,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
        ],
      }),
      "bookmarks:listProject": () => ({
        projectId: "project_1",
        totalCount: 25,
        filteredCount: 25,
        page: 0,
        pageSize: 10,
        categoryCounts: {
          user: 0,
          assistant: 25,
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
            bookmarkedAt: "2026-03-01T10:10:00.000Z",
            isOrphaned: false,
            orphanedAt: null,
            message: {
              id: "bookmark_1",
              sourceId: "bookmark_source_1",
              sessionId: "session_1",
              provider: "claude",
              category: "assistant",
              content: "Saved markdown summary",
              createdAt: "2026-03-01T10:10:00.000Z",
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
            bookmarkedAt: "2026-03-01T10:11:00.000Z",
            isOrphaned: false,
            orphanedAt: null,
            message: {
              id: "bookmark_2",
              sourceId: "bookmark_source_2",
              sessionId: "session_1",
              provider: "claude",
              category: "assistant",
              content: "Saved second summary",
              createdAt: "2026-03-01T10:11:00.000Z",
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

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            messagePageSize: 10,
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Bookmarks/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /Bookmarks/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Bookmarks/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByText("Saved markdown summary")).toBeInTheDocument();
    expect(screen.getByText("25 of 25 bookmarked messages")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");

    await user.click(screen.getByRole("tab", { name: /Flat/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Flat/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
  });

  it("shows filtered and total message counts for session and all-sessions views", async () => {
    const user = userEvent.setup();
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 7,
            bookmarkCount: 0,
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
            messageCount: 3,
            bookmarkCount: 0,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
        ],
      }),
      "sessions:getDetail": () => ({
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
          messageCount: 3,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
        totalCount: 1,
        categoryCounts: {
          user: 1,
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
        ],
      }),
      "projects:getCombinedDetail": () => ({
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
            content: "Everything checks out.",
            createdAt: "2026-03-01T10:00:05.000Z",
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
      expect(screen.getByText("1 of 3 messages")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /All Sessions/i }));

    await waitFor(() => {
      expect(screen.getByText("2 of 7 messages")).toBeInTheDocument();
    });
  });

  it("reveals messages in the project tree when the Sessions pane is collapsed", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            projectPaneCollapsed: true,
            projectViewMode: "list",
            sessionPaneCollapsed: true,
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Reveal this message in project" })).toBeNull();
    const [revealButton] = screen.getAllByRole("button", {
      name: "Reveal this message in session",
    });
    expect(revealButton).toBeDefined();
    if (!revealButton) {
      throw new Error("Expected reveal button");
    }

    await user.click(revealButton);

    await waitFor(() => {
      const treeSessionButton = container.querySelector<HTMLButtonElement>(
        '.project-tree-session-row[data-session-id="session_1"]',
      );
      expect(treeSessionButton).not.toBeNull();
      expect(treeSessionButton?.classList.contains("active")).toBe(true);
    });

    expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
  });

  it("reveals a session message in the project's all sessions view from the message card", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

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

    let revealInProjectButton: HTMLElement | null = null;
    await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: "Reveal this message in project" });
      expect(buttons.length).toBeGreaterThan(0);
      revealInProjectButton = buttons[0] ?? null;
    });
    expect(screen.queryByRole("button", { name: "Reveal this message in session" })).toBeNull();

    if (!revealInProjectButton) {
      throw new Error("Expected reveal-in-project button");
    }

    await user.click(revealInProjectButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /first \(all sessions\)\. switch to/i }),
      ).toBeInTheDocument();
    });
  });

  it("reveals session leaves in the project tree and keeps the Sessions pane collapsed", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(
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
      expect(screen.getByRole("button", { name: /project-one|Project One/i })).toBeInTheDocument();
    });

    const projectRowSelector = '[data-project-nav-kind="project"][data-project-nav-id="project_1"]';
    let projectTreeButton = container.querySelector<HTMLButtonElement>(projectRowSelector);
    if (!projectTreeButton) {
      fireEvent.doubleClick(screen.getByRole("button", { name: /\/workspace\/project-one/i }));
      await waitFor(() => {
        expect(container.querySelector<HTMLButtonElement>(projectRowSelector)).not.toBeNull();
      });
      projectTreeButton = container.querySelector<HTMLButtonElement>(projectRowSelector);
    }
    if (!projectTreeButton) {
      throw new Error("Expected project tree button");
    }

    fireEvent.doubleClick(projectTreeButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Investigate markdown rendering/i }),
      ).toBeInTheDocument();
    });

    const treeSessionButton = container.querySelector<HTMLButtonElement>(
      '.project-tree-session-row[data-session-id="session_1"]',
    );
    expect(treeSessionButton).not.toBeNull();
    if (!treeSessionButton) {
      throw new Error("Expected tree session button");
    }

    await user.click(treeSessionButton);

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    const workspace = container.querySelector<HTMLElement>(".workspace.history-layout");
    expect(workspace?.style.getPropertyValue("--session-pane-width")).toBe("36px");
    expect(screen.queryByRole("button", { name: /Switch to All Sessions/i })).toBeNull();
  });

  it("switches to the project's all-sessions view when collapsing the selected session's project in the tree", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();

    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            hideSessionsPaneInTreeView: true,
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    const projectRowSelector = '[data-project-nav-kind="project"][data-project-nav-id="project_1"]';
    let projectTreeButton = container.querySelector<HTMLButtonElement>(projectRowSelector);
    if (!projectTreeButton) {
      fireEvent.doubleClick(screen.getByRole("button", { name: /\/workspace\/project-one/i }));
      await waitFor(() => {
        expect(container.querySelector<HTMLButtonElement>(projectRowSelector)).not.toBeNull();
      });
      projectTreeButton = container.querySelector<HTMLButtonElement>(projectRowSelector);
    }
    if (!projectTreeButton) {
      throw new Error("Expected project tree button");
    }

    fireEvent.doubleClick(projectTreeButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Investigate markdown rendering/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse project sessions" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Investigate markdown rendering/i }));

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    const projectDetailCallsBeforeCollapse = client.invoke.mock.calls.filter(
      ([channel, payload]) =>
        channel === "projects:getCombinedDetail" &&
        (payload as { projectId?: string }).projectId === "project_1",
    ).length;

    await user.click(screen.getByRole("button", { name: "Collapse project sessions" }));

    await waitFor(() => {
      const projectDetailCallsAfterCollapse = client.invoke.mock.calls.filter(
        ([channel, payload]) =>
          channel === "projects:getCombinedDetail" &&
          (payload as { projectId?: string }).projectId === "project_1",
      ).length;
      expect(projectDetailCallsAfterCollapse).toBeGreaterThan(projectDetailCallsBeforeCollapse);
      expect(
        screen.getByRole("button", {
          name: "Newest first (all sessions). Switch to oldest first",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Switch to All Sessions/i })).toBeNull();
    });

    expect(screen.queryByRole("button", { name: /Investigate markdown rendering/i })).toBeNull();
  });

  it("keeps the selected session view when collapsing a different project in the tree", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 2,
            messageCount: 4,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 1,
            lastActivity: "2026-03-01T10:00:06.000Z",
          },
        ],
      }),
    });

    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            hideSessionsPaneInTreeView: true,
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    const projectFolder = screen.getByRole("button", {
      name: /(?:\/workspace\/project-two|~\/project-two), 1 projects/i,
    });
    await user.click(projectFolder);
    await waitFor(() => {
      expect(document.querySelector('[data-project-expand-toggle-for="project_2"]')).not.toBeNull();
    });

    const projectOneDetailCallsBefore = client.invoke.mock.calls.filter(
      ([channel, payload]) =>
        channel === "projects:getCombinedDetail" &&
        (payload as { projectId?: string }).projectId === "project_1",
    ).length;

    const projectTwoToggle = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_2"]',
    );
    expect(projectTwoToggle).not.toBeNull();
    if (!projectTwoToggle) {
      throw new Error("Expected project-two expand toggle");
    }

    await user.click(projectTwoToggle);
    await waitFor(() => {
      expect(projectTwoToggle.getAttribute("aria-label")).toBe("Collapse project sessions");
    });

    await user.click(projectTwoToggle);
    await waitFor(() => {
      expect(projectTwoToggle.getAttribute("aria-label")).toBe("Expand project sessions");
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "Newest first (all sessions). Switch to oldest first",
        }),
      ).toBeNull();
    });

    const projectOneDetailCallsAfter = client.invoke.mock.calls.filter(
      ([channel, payload]) =>
        channel === "projects:getCombinedDetail" &&
        (payload as { projectId?: string }).projectId === "project_1",
    ).length;

    expect(projectOneDetailCallsAfter).toBe(projectOneDetailCallsBefore);
  });

  it("does not start resizing the Sessions pane while it is collapsed", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();
    const { container } = renderWithClient(
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
    });

    const resizers = Array.from(container.querySelectorAll<HTMLElement>(".pane-resizer"));
    expect(resizers).toHaveLength(2);
    const sessionResizer = resizers[1];
    expect(sessionResizer).toBeDefined();
    if (!sessionResizer) {
      throw new Error("Expected session resizer");
    }
    expect(sessionResizer.classList.contains("pane-resizer-disabled")).toBe(true);

    fireEvent.pointerDown(sessionResizer, { clientX: 500 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 620 }));

    expect(document.body.classList.contains("resizing-panels")).toBe(false);

    const workspace = container.querySelector<HTMLElement>(".workspace.history-layout");
    expect(workspace?.style.getPropertyValue("--session-pane-width")).toBe("36px");
  });

  it("hides the Sessions pane in tree view when toggled from project options", async () => {
    installScrollIntoViewMock();
    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(
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
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
    });

    expect(container.querySelector(".session-pane")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(screen.getByRole("button", { name: "Hide Sessions pane in tree view" }));

    await waitFor(() => {
      expect(container.querySelector(".session-pane")).toBeNull();
    });

    const workspace = container.querySelector<HTMLElement>(".workspace.history-layout");
    expect(workspace?.classList.contains("tree-sessions-hidden")).toBe(true);
    expect(container.querySelectorAll(".pane-resizer")).toHaveLength(1);
  });

  it("opens the project delete dialog with JSONL-specific guidance and invokes project deletion", async () => {
    installScrollIntoViewMock();
    installDialogMock();

    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText("Delete Project From Code Trail?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This removes the indexed project history, its sessions, and any related bookmarks from Code Trail only. Raw transcript files on disk will not be changed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "If the same JSONL transcript file only grows by appending new content, Code Trail will ingest only the new tail.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Project" }));

    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith("projects:delete", { projectId: "project_1" });
    });
  });

  it("shows materialized-json deletion guidance for project deletes", async () => {
    installScrollIntoViewMock();
    installDialogMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_gemini",
            provider: "gemini",
            name: "Gemini Project",
            path: "/workspace/gemini-project",
            sessionCount: 1,
            messageCount: 4,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
        ],
      }),
      "sessions:list": () => ({
        sessions: [
          {
            id: "session_gemini",
            projectId: "project_gemini",
            provider: "gemini",
            filePath: "/workspace/gemini-project/session-1.json",
            title: "Gemini session",
            modelNames: "gemini-2.5-pro",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: "/workspace/gemini-project",
            messageCount: 4,
            tokenInputTotal: 10,
            tokenOutputTotal: 5,
          },
        ],
      }),
      "sessions:getDetail": () => ({
        session: {
          id: "session_gemini",
          projectId: "project_gemini",
          provider: "gemini",
          filePath: "/workspace/gemini-project/session-1.json",
          title: "Gemini session",
          modelNames: "gemini-2.5-pro",
          startedAt: "2026-03-01T10:00:00.000Z",
          endedAt: "2026-03-01T10:00:05.000Z",
          durationMs: 5000,
          gitBranch: "main",
          cwd: "/workspace/gemini-project",
          messageCount: 4,
          tokenInputTotal: 10,
          tokenOutputTotal: 5,
        },
        totalCount: 1,
        categoryCounts: {
          user: 1,
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
        messages: [
          {
            id: "gm1",
            sourceId: "gm-src-1",
            sessionId: "session_gemini",
            provider: "gemini",
            category: "user",
            content: "Gemini content",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        ],
      }),
    });

    renderWithClient(
      <App
        initialPaneState={
          {
            enabledProviders: ["gemini"],
            projectProviders: ["gemini"],
            searchProviders: ["gemini"],
            selectedProjectId: "project_gemini",
            selectedSessionId: "session_gemini",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Gemini Project")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText("Delete Project From Code Trail?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This provider stores history as whole-file JSON, not append-resumable JSONL.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Code Trail will not restore partial changes from rewritten files during incremental refresh.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an inline delete error and keeps the dialog open when project deletion fails", async () => {
    installScrollIntoViewMock();
    installDialogMock();

    const user = userEvent.setup();
    const client = createAppClient({
      "projects:delete": () => ({
        deleted: false,
        provider: null,
        sourceFormat: null,
        removedSessionCount: 0,
        removedMessageCount: 0,
        removedBookmarkCount: 0,
      }),
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete Project" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project no longer exists in the database.",
    );
    expect(screen.getByText("Delete Project From Code Trail?")).toBeInTheDocument();
  });

  it("disables project deletion from the header options when a folder row is focused", async () => {
    installScrollIntoViewMock();
    installDialogMock();

    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            hideSessionsPaneInTreeView: true,
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    const projectFolder = screen.getByRole("button", {
      name: /(?:\/workspace\/project-one|~\/project-one), 1 projects/i,
    });
    await user.click(projectFolder);
    await user.click(screen.getByRole("button", { name: "Project options" }));

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    const reindexButton = screen.getByRole("button", { name: "Reindex Project…" });
    expect(deleteButton).toBeDisabled();
    expect(reindexButton).toBeDisabled();

    await user.click(deleteButton);
    expect(screen.queryByText("Delete Project From Code Trail?")).toBeNull();

    await user.click(reindexButton);
    expect(screen.queryByRole("heading", { name: "Reindex Project" })).toBeNull();
  });

  it("routes tree session context menu actions through the real session handlers", async () => {
    installScrollIntoViewMock();
    installDialogMock();

    copyTextToClipboard.mockClear();
    openPath.mockClear();

    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(
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
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
    });

    fireEvent.doubleClick(screen.getByRole("button", { name: /Project One/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Investigate markdown rendering/i }),
      ).toBeInTheDocument();
    });

    const treeSessionButton = container.querySelector<HTMLButtonElement>(
      '.project-tree-session-row[data-session-id="session_1"]',
    );
    expect(treeSessionButton).not.toBeNull();
    if (!treeSessionButton) {
      throw new Error("Expected tree session button");
    }

    fireEvent.contextMenu(treeSessionButton);
    await user.click(screen.getByRole("menuitem", { name: "Copy" }));

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining("Title: Investigate markdown rendering"),
    );

    fireEvent.contextMenu(treeSessionButton);
    await user.click(screen.getByRole("menuitem", { name: "Open Folder" }));

    expect(openPath).toHaveBeenCalledWith("/workspace/project-one/session-1.jsonl");

    fireEvent.contextMenu(treeSessionButton);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByText("Delete Session From Code Trail?")).toBeInTheDocument();
    expect(document.querySelector(".delete-history-dialog-target-title")?.textContent).toContain(
      "Investigate markdown rendering",
    );
  });
});
