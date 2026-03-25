// @vitest-environment jsdom

import { createClaudeHookStateFixture, createLiveStatusFixture } from "@codetrail/core/testing";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import { createAppClient, installScrollIntoViewMock } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

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
        screen.getByRole("button", { name: "Show or hide User messages (18,457)" }),
      ).toBeInTheDocument();
    });

    expect(container.querySelector(".msg-filter.user-filter .filter-count")).toHaveTextContent(
      "18.5K",
    );
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

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
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
            id: "tool_1",
            sourceId: "tool_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "tool_use",
            content: JSON.stringify({
              tool_name: "Read",
              input: { file_path: "/workspace/project-one/src/app.ts" },
            }),
            createdAt: "2026-03-01T10:00:02.000Z",
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

    await waitFor(() => {
      expect(screen.getByText("User body")).toBeInTheDocument();
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(1);
    });

    await user.click(screen.getByRole("button", { name: "Expand all messages" }));
    await waitFor(() => {
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(3);
    });

    await user.click(screen.getAllByRole("button", { name: "Collapse message" })[0]!);
    expect(container.querySelectorAll(".message.expanded")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Collapse all messages" }));
    await waitFor(() => {
      expect(container.querySelectorAll(".message.expanded")).toHaveLength(0);
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
      expect(screen.getByText("4 messages")).toBeInTheDocument();
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
    expect(document.activeElement).toBe(messageList);

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
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("250 messages")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    });

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(([channel]) => channel === "search:query");
      expect(calls.some(([, payload]) => (payload as { offset?: number }).offset === 100)).toBe(
        true,
      );
    });

    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
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

    expect(screen.getByText("Previous page")).toBeInTheDocument();
    expect(screen.getByText("Next page")).toBeInTheDocument();
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
    expect(screen.getByText("Force Reindex")).toBeInTheDocument();
    expect(screen.getByText(/they can disappear after this reindex/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Force reindex" }));
    await user.click(screen.getByRole("button", { name: "Reindex" }));

    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel, payload]) =>
          channel === "indexer:refresh" && (payload as { force?: boolean }).force === true,
      );
      expect(refreshCalls.length).toBeGreaterThan(0);
    });
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
      expect(screen.getByRole("button", { name: "2 bookmarks" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "2 bookmarks" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close bookmarks" })).toBeInTheDocument();
    });
    expect(screen.getByText("Saved markdown summary")).toBeInTheDocument();
    expect(screen.getByText("25 bookmarks")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");

    await user.click(screen.getByRole("button", { name: "Close bookmarks" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "2 bookmarks" })).toBeInTheDocument();
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

    await user.click(treeSessionButton);

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    const workspace = container.querySelector<HTMLElement>(".workspace.history-layout");
    expect(workspace?.style.getPropertyValue("--session-pane-width")).toBe("36px");
    expect(screen.queryByRole("button", { name: /Switch to All Sessions/i })).toBeNull();
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
