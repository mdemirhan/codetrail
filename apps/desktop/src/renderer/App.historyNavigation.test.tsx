// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { SEARCH_PLACEHOLDERS } from "./lib/searchPlaceholders";
import {
  createHistoryNavigationClient,
  createProjectSwitchBookmarksDelayClient,
  installScrollIntoViewMock,
} from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App history navigation", () => {
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

    await user.click(screen.getByText("Session one"));
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    await waitFor(() => {
      expect(screen.getByText("Session two message")).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Project two combined message")).toBeInTheDocument();
      expect(document.activeElement).toBe(projectList());
    });

    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Project one first message")).toBeInTheDocument();
      expect(document.activeElement).toBe(projectList());
    });
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

    await user.click(screen.getByText("Session one"));
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.historyBookmarks)).toBeInTheDocument();
      expect(document.activeElement).toBe(sessionList());
    });

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.historyProjectSessions),
      ).toBeInTheDocument();
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
