// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { SEARCH_PLACEHOLDERS } from "./lib/searchPlaceholders";
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

    renderWithClient(<App />, client);

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
    expect(workspace.style.getPropertyValue("--session-pane-width")).toBe("320px");
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
        "Off",
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
      "Off",
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
});
