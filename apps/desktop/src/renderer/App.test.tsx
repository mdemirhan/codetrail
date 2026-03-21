// @vitest-environment jsdom

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
  it("loads history, supports global search navigation, and opens settings", async () => {
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

  it("routes Cmd/Ctrl+Left/Right to history and global search pagination", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Page 1 / 3 (250 messages)")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 2 / 3 (250 messages)")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(([channel]) => channel === "search:query");
      expect(calls.some(([, payload]) => (payload as { offset?: number }).offset === 100)).toBe(
        true,
      );
    });

    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
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

    renderWithClient(
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

    renderWithClient(
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

  it("restores the last selected auto-refresh mode with Cmd/Ctrl+Shift+R", async () => {
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
      expect(
        screen.getByTitle(
          "Number of changed files currently queued by the watcher before auto-refresh runs.",
        ),
      ).toHaveTextContent("2");
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
        totalCount: 2,
        filteredCount: 2,
        categoryCounts: {
          user: 0,
          assistant: 2,
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
      expect(screen.getByRole("button", { name: "2 bookmarks" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "2 bookmarks" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close bookmarks" })).toBeInTheDocument();
    });
    expect(screen.getByText("Saved markdown summary")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close bookmarks" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "2 bookmarks" })).toBeInTheDocument();
    });
    expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
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
      expect(screen.getByText("2 messages")).toBeInTheDocument();
    });

    const workspace = container.querySelector<HTMLElement>(".workspace.history-layout");
    expect(workspace?.style.getPropertyValue("--session-pane-width")).toBe("36px");
    expect(screen.queryByRole("button", { name: /Switch to All Sessions/i })).toBeNull();
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
