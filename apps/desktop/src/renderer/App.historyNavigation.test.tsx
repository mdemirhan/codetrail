// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App, setTestHistorySelectionDebounceOverrides } from "./App";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import {
  createHistoryNavigationClient,
  createProjectSwitchBookmarksDelayClient,
  installScrollIntoViewMock,
} from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

function expectDefined<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
}

async function expandHistoryPanes() {
  const expandProjectsButton = screen.queryByRole("button", { name: "Expand Projects pane" });
  if (expandProjectsButton) {
    fireEvent.click(expandProjectsButton);
  }
  const expandSessionsButton = screen.queryByRole("button", { name: "Expand Sessions pane" });
  if (expandSessionsButton) {
    fireEvent.click(expandSessionsButton);
  }
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Collapse Projects pane" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Sessions pane" })).toBeInTheDocument();
  });
}

describe("App history navigation", () => {
  beforeEach(() => {
    setTestHistorySelectionDebounceOverrides({ project: 1, session: 1 });
  });

  afterEach(() => {
    setTestHistorySelectionDebounceOverrides(null);
  });

  it("navigates sessions with Option+Up/Down and projects with Ctrl+Up/Down", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createHistoryNavigationClient();
    const { container } = renderWithClient(<App />, client);
    const sessionList = () => container.querySelector<HTMLDivElement>(".list-scroll.session-list");
    const projectList = () => container.querySelector<HTMLDivElement>(".list-scroll.project-list");

    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
    });

    await expandHistoryPanes();

    await user.click(await screen.findByText("Session one"));
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    fireEvent.keyUp(window, { key: "ArrowDown", altKey: true });
    await waitFor(() => {
      expect(screen.getByText("Session two message")).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    fireEvent.keyUp(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
    fireEvent.keyUp(window, { key: "ArrowDown", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Project two combined message")).toBeInTheDocument();
      expect(projectList()?.contains(document.activeElement)).toBe(true);
      expect(
        document.activeElement?.getAttribute("data-project-nav-id") ??
          document.activeElement
            ?.closest("[data-project-nav-id]")
            ?.getAttribute("data-project-nav-id"),
      ).toBe("project_2");
    });

    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    fireEvent.keyUp(window, { key: "ArrowUp", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
      expect(projectList()?.contains(document.activeElement)).toBe(true);
      expect(
        document.activeElement?.getAttribute("data-project-nav-id") ??
          document.activeElement
            ?.closest("[data-project-nav-id]")
            ?.getAttribute("data-project-nav-id"),
      ).toBe("project_1");
    });
  });

  it("moves between projects and sessions with plain Up/Down when their panes are focused", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createHistoryNavigationClient();
    const { container } = renderWithClient(<App />, client);
    const sessionList = () => container.querySelector<HTMLDivElement>(".list-scroll.session-list");
    const projectList = () => container.querySelector<HTMLDivElement>(".list-scroll.project-list");

    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
    });

    await expandHistoryPanes();

    await user.click(await screen.findByText("Session one"));
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
    });

    const sessionPane = expectDefined(sessionList(), "Expected session list");
    sessionPane.focus();
    fireEvent.keyDown(sessionPane, { key: "ArrowUp" });
    fireEvent.keyUp(window, { key: "ArrowUp" });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    const projectPane = expectDefined(projectList(), "Expected project list");
    projectPane.focus();
    fireEvent.keyDown(projectPane, { key: "ArrowDown" });
    fireEvent.keyDown(projectPane, { key: "ArrowDown" });
    fireEvent.keyUp(window, { key: "ArrowDown" });
    await waitFor(() => {
      expect(screen.getByText("Project two combined message")).toBeInTheDocument();
      expect(projectList()?.contains(document.activeElement)).toBe(true);
      expect(
        document.activeElement?.getAttribute("data-project-nav-id") ??
          document.activeElement
            ?.closest("[data-project-nav-id]")
            ?.getAttribute("data-project-nav-id"),
      ).toBe("project_2");
    });
  });

  it("focuses the messages pane when the app starts in history view", async () => {
    installScrollIntoViewMock();

    const client = createHistoryNavigationClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
      expect(document.activeElement).toBe(messageList());
    });
  });

  it("moves pane focus from the titlebar into the history panes with Tab", async () => {
    installScrollIntoViewMock();

    const client = createHistoryNavigationClient();
    const { container } = renderWithClient(<App />, client);
    const sessionList = () => container.querySelector<HTMLDivElement>(".list-scroll.session-list");
    const projectList = () => container.querySelector<HTMLDivElement>(".list-scroll.project-list");
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
    });

    const globalSearchButton = screen.getByRole("button", { name: "Search" });
    globalSearchButton.focus();
    fireEvent.keyDown(document.activeElement ?? window, { key: "Tab" });
    await waitFor(() => {
      expect(document.activeElement).toBe(projectList());
    });

    expectDefined(projectList(), "Expected project list");
    expectDefined(sessionList(), "Expected session list");
    expectDefined(messageList(), "Expected message list");
  });

  it("updates pane controls correctly when history panes are collapsed", async () => {
    installScrollIntoViewMock();

    const client = createHistoryNavigationClient();
    const { container } = renderWithClient(<App />, client);
    const sessionList = () => container.querySelector<HTMLDivElement>(".list-scroll.session-list");
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
    });

    const expandProjectsButton = screen.queryByRole("button", { name: "Expand Projects pane" });
    const expandSessionsButton = screen.queryByRole("button", { name: "Expand Sessions pane" });
    if (expandProjectsButton) {
      fireEvent.click(expandProjectsButton);
    }
    if (expandSessionsButton) {
      fireEvent.click(expandSessionsButton);
    }

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse Projects pane" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse Sessions pane" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse Sessions pane" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand Sessions pane" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse Projects pane" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand Projects pane" })).toBeInTheDocument();
    });

    expectDefined(sessionList(), "Expected session list");
    expectDefined(messageList(), "Expected message list");
  });

  it("includes All Sessions and Bookmarked Messages when moving up from the first session", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createHistoryNavigationClient();
    const { container } = renderWithClient(<App />, client);
    const sessionList = () => container.querySelector<HTMLDivElement>(".list-scroll.session-list");

    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
    });

    await expandHistoryPanes();

    await user.click(screen.getByText("Session one"));
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    fireEvent.keyUp(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    fireEvent.keyUp(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });
  });

  it("waits to swap the sessions pane until bookmarks are loaded for the selected project", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const { client, delayedBookmarks } = createProjectSwitchBookmarksDelayClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project one session")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Project Two"));

    await waitFor(() => {
      expect(screen.getByText("Project Two")).toBeInTheDocument();
    });

    expect(screen.queryByText("Project two delayed bookmarks session")).toBeNull();
    expect(screen.queryByText("Bookmarked Messages")).toBeNull();

    delayedBookmarks.resolve({
      projectId: "project_2",
      totalCount: 1,
      filteredCount: 1,
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
          projectId: "project_2",
          sessionId: "session_2",
          sessionTitle: "Project two delayed bookmarks session",
          bookmarkedAt: "2026-03-01T11:01:00.000Z",
          isOrphaned: false,
          orphanedAt: null,
          message: {
            id: "project_2_bookmark",
            sourceId: "project_2_bookmark_src",
            sessionId: "session_2",
            provider: "claude",
            category: "assistant",
            content: "Delayed project two bookmark",
            createdAt: "2026-03-01T11:01:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Project two delayed bookmarks session")).toBeInTheDocument();
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    });
  });
});
