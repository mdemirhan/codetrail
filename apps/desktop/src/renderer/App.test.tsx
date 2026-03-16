// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { SEARCH_PLACEHOLDERS } from "./lib/searchPlaceholders";
import { createAppClient, installScrollIntoViewMock } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

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

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    expect(screen.getByRole("heading", { name: "Global Search" })).toBeInTheDocument();

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

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("Page 1 / 3 (250 matches)")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 2 / 3 (250 matches)")).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(([channel]) => channel === "search:query");
      expect(calls.some(([, payload]) => (payload as { offset?: number }).offset === 100)).toBe(
        true,
      );
    });

    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 1 / 3 (250 matches)")).toBeInTheDocument();
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

  it("disables refresh and reindex controls while background indexing is active", async () => {
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
    expect(screen.getByRole("button", { name: "Force reindex" })).toBeDisabled();
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
