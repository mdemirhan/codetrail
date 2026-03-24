// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "../../app/types";
import { SessionPane } from "./SessionPane";

function createSessionSummary(
  overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "projectId">,
): SessionSummary {
  const { id, projectId, ...rest } = overrides;
  return {
    id,
    projectId,
    provider: "claude",
    filePath: "/tmp/session-1.jsonl",
    title: "Investigate markdown rendering",
    modelNames: "claude-opus",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:00:05.000Z",
    durationMs: 5000,
    gitBranch: "main",
    cwd: "/workspace",
    sessionIdentity: null,
    providerSessionId: null,
    sessionKind: null,
    canonicalProjectPath: null,
    repositoryUrl: null,
    gitCommitHash: null,
    lineageParentId: null,
    providerClient: null,
    providerSource: null,
    providerClientVersion: null,
    resolutionSource: null,
    worktreeLabel: null,
    worktreeSource: null,
    messageCount: 3,
    bookmarkCount: 0,
    tokenInputTotal: 10,
    tokenOutputTotal: 8,
    ...rest,
  };
}

const sessions: SessionSummary[] = [
  createSessionSummary({ id: "session_1", projectId: "project_1" }),
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
        canDeleteSession={true}
        canOpenSessionLocation={true}
        onToggleCollapsed={onToggleCollapsed}
        onToggleSortDirection={onToggleSortDirection}
        onCopySession={onCopySession}
        onDeleteSession={vi.fn()}
        onOpenSessionLocation={onOpenSessionLocation}
        onSelectAllSessions={onSelectAllSessions}
        onSelectBookmarks={onSelectBookmarks}
        onSelectSession={onSelectSession}
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse Sessions pane" })).toHaveAttribute(
      "title",
      "Collapse Sessions  ⌘⇧B",
    );
    await user.click(screen.getByRole("button", { name: "Collapse Sessions pane" }));
    await user.click(
      screen.getByRole("button", {
        name: "Newest first (sessions). Switch to oldest first",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Session options" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("button", { name: "Session options" }));
    await user.click(screen.getByRole("button", { name: "Open Folder" }));
    await user.click(screen.getByRole("button", { name: /All Sessions/i }));
    await user.click(screen.getByRole("button", { name: /Bookmarked Messages/i }));
    await user.click(screen.getByRole("button", { name: /Investigate markdown rendering/i }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onToggleSortDirection).toHaveBeenCalledTimes(1);
    expect(onCopySession).toHaveBeenCalledTimes(1);
    expect(onOpenSessionLocation).toHaveBeenCalledTimes(1);
    expect(onSelectAllSessions).toHaveBeenCalledTimes(1);
    expect(onSelectBookmarks).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("session_1");
  });

  it("hides toolbar actions and quick-switch buttons when collapsed", () => {
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
        canDeleteSession={false}
        canOpenSessionLocation={false}
        onToggleCollapsed={vi.fn()}
        onToggleSortDirection={vi.fn()}
        onCopySession={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSessionLocation={vi.fn()}
        onSelectAllSessions={vi.fn()}
        onSelectBookmarks={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: "Oldest first (sessions). Switch to newest first",
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Session options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Switch to All Sessions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Switch to Bookmarks" })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Sessions pane" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Sessions pane" })).toHaveAttribute(
      "title",
      "Expand Sessions  ⌘⇧B",
    );
  });

  it("scrolls the active All Sessions and Bookmarked Messages rows into view", () => {
    const scrollIntoView = vi.fn();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();

    const { rerender } = render(
      <SessionPane
        sortedSessions={sessions}
        selectedSessionId=""
        sortDirection="desc"
        allSessionsCount={7}
        allSessionsSelected={true}
        bookmarksCount={2}
        bookmarksSelected={false}
        collapsed={false}
        canCopySession={true}
        canDeleteSession={true}
        canOpenSessionLocation={true}
        onToggleCollapsed={vi.fn()}
        onToggleSortDirection={vi.fn()}
        onCopySession={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSessionLocation={vi.fn()}
        onSelectAllSessions={vi.fn()}
        onSelectBookmarks={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    scrollIntoView.mockClear();

    rerender(
      <SessionPane
        sortedSessions={sessions}
        selectedSessionId=""
        sortDirection="desc"
        allSessionsCount={7}
        allSessionsSelected={false}
        bookmarksCount={2}
        bookmarksSelected={true}
        collapsed={false}
        canCopySession={true}
        canDeleteSession={true}
        canOpenSessionLocation={true}
        onToggleCollapsed={vi.fn()}
        onToggleSortDirection={vi.fn()}
        onCopySession={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSessionLocation={vi.fn()}
        onSelectAllSessions={vi.fn()}
        onSelectBookmarks={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("opens a session context menu with grouped actions for the clicked row", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    const onCopySession = vi.fn();
    const onOpenSessionLocation = vi.fn();
    const onDeleteSession = vi.fn();

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
        canDeleteSession={true}
        canOpenSessionLocation={true}
        onToggleCollapsed={vi.fn()}
        onToggleSortDirection={vi.fn()}
        onCopySession={onCopySession}
        onDeleteSession={onDeleteSession}
        onOpenSessionLocation={onOpenSessionLocation}
        onSelectAllSessions={vi.fn()}
        onSelectBookmarks={vi.fn()}
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /Investigate markdown rendering/i }));

    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open Folder" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onSelectSession).toHaveBeenCalledWith("session_1");
    expect(onDeleteSession).toHaveBeenCalledWith("session_1");
    expect(screen.queryByRole("menuitem", { name: "Copy" })).toBeNull();
  });
});
