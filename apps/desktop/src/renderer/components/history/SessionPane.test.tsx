// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionPane } from "./SessionPane";

const sessions = [
  {
    id: "session_1",
    projectId: "project_1",
    provider: "claude" as const,
    filePath: "/tmp/session-1.jsonl",
    title: "Investigate markdown rendering",
    modelNames: "claude-opus",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:00:05.000Z",
    durationMs: 5000,
    gitBranch: "main",
    cwd: "/workspace",
    messageCount: 3,
    tokenInputTotal: 10,
    tokenOutputTotal: 8,
  },
];

describe("SessionPane", () => {
  it("renders sessions and bookmark row interactions", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
    });

    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();
    const onToggleSortDirection = vi.fn();
    const onCopySession = vi.fn();
    const onOpenSessionLocation = vi.fn();
    const onSelectAllSessions = vi.fn();
    const onSelectBookmarks = vi.fn();
    const onSelectSession = vi.fn();

    render(
      <SessionPane
        sortedSessions={sessions}
        selectedSessionId="session_1"
        sortDirection="desc"
        allSessionsCount={7}
        allSessionsSelected={false}
        bookmarksCount={2}
        bookmarksSelected={false}
        collapsed={false}
        canCopySession={true}
        canOpenSessionLocation={true}
        onToggleCollapsed={onToggleCollapsed}
        onToggleSortDirection={onToggleSortDirection}
        onCopySession={onCopySession}
        onOpenSessionLocation={onOpenSessionLocation}
        onSelectAllSessions={onSelectAllSessions}
        onSelectBookmarks={onSelectBookmarks}
        onSelectSession={onSelectSession}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse Sessions pane" }));
    await user.click(screen.getByRole("button", { name: "Sort sessions ascending" }));
    await user.click(screen.getByRole("button", { name: "Copy session details" }));
    await user.click(screen.getByRole("button", { name: "Open session folder" }));
    await user.click(screen.getByRole("button", { name: /All Sessions/i }));
    await user.click(screen.getByRole("button", { name: /Bookmarked messages/i }));
    await user.click(screen.getByRole("button", { name: /Investigate markdown rendering/i }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onToggleSortDirection).toHaveBeenCalledTimes(1);
    expect(onCopySession).toHaveBeenCalledTimes(1);
    expect(onOpenSessionLocation).toHaveBeenCalledTimes(1);
    expect(onSelectAllSessions).toHaveBeenCalledTimes(1);
    expect(onSelectBookmarks).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("session_1");
  });

  it("shows collapsed quick-switch icons and hides bookmark icon when count is zero", async () => {
    const user = userEvent.setup();
    const onSelectAllSessions = vi.fn();
    const onSelectBookmarks = vi.fn();

    render(
      <SessionPane
        sortedSessions={sessions}
        selectedSessionId=""
        sortDirection="asc"
        allSessionsCount={3}
        allSessionsSelected={true}
        bookmarksCount={0}
        bookmarksSelected={false}
        collapsed={true}
        canCopySession={false}
        canOpenSessionLocation={false}
        onToggleCollapsed={vi.fn()}
        onToggleSortDirection={vi.fn()}
        onCopySession={vi.fn()}
        onOpenSessionLocation={vi.fn()}
        onSelectAllSessions={onSelectAllSessions}
        onSelectBookmarks={onSelectBookmarks}
        onSelectSession={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Switch to All Sessions" }));

    expect(onSelectAllSessions).toHaveBeenCalledTimes(1);
    expect(onSelectBookmarks).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Switch to Bookmarks" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sort sessions descending" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy session details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open session folder" })).toBeNull();
    expect(screen.getByText("All Sessions")).toBeInTheDocument();
    expect(screen.queryByText("Bookmarked messages")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Sessions pane" })).toBeInTheDocument();
  });
});
