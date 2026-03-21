// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import {
  createBookmarkSearchDelayClient,
  createBookmarksSearchClient,
} from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App bookmarks", () => {
  it("searches bookmarks via bookmarks:listProject query payload", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    const bookmarksSearch = screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages);
    await user.clear(bookmarksSearch);
    await user.type(bookmarksSearch, "no-match-token");

    await waitFor(() => {
      expect(
        screen.getByText(/No (bookmarked )?messages match current filters\./),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "bookmarks:listProject",
      );
      expect(
        calls.some(([, payload]) => (payload as { query?: string }).query === "no-match-token"),
      ).toBe(true);
    });
  });

  it("keeps the session list stable while a bookmark search is in flight", async () => {
    const { client, delayedBookmarks } = createBookmarkSearchDelayClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
      expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), {
      target: { value: "delayed-search" },
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "bookmarks:listProject",
      );
      expect(
        calls.some(([, payload]) => (payload as { query?: string }).query === "delayed-search"),
      ).toBe(true);
    });

    expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();

    delayedBookmarks.resolve({
      projectId: "project_1",
      totalCount: 1,
      filteredCount: 0,
      categoryCounts: {
        user: 0,
        assistant: 0,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      results: [],
    });

    await waitFor(() => {
      expect(
        screen.getByText(/No (bookmarked )?messages match current filters\./),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();
  });

  it("keeps bookmarks mode when Cmd/Ctrl+F searches messages", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    const bookmarksSearch = screen.getByPlaceholderText(
      SEARCH_PLACEHOLDERS.globalMessages,
    ) as HTMLInputElement;

    await user.keyboard("{Control>}f{/Control}");

    await waitFor(() => {
      expect(document.activeElement).toBe(bookmarksSearch);
    });
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDERS.historySession)).toBeNull();
  });
});
