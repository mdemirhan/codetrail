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
    const onSelectBookmarks = vi.fn();
    const onSelectSession = vi.fn();

    render(
      <SessionPane
        sortedSessions={sessions}
        selectedSessionId="session_1"
        bookmarksCount={2}
        bookmarksSelected={false}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        onSelectBookmarks={onSelectBookmarks}
        onSelectSession={onSelectSession}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse Sessions pane" }));
    await user.click(screen.getByRole("button", { name: /Bookmarked messages/i }));
    await user.click(screen.getByRole("button", { name: /Investigate markdown rendering/i }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onSelectBookmarks).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("session_1");
  });

  it("hides bookmark row when bookmark count is zero", () => {
    render(
      <SessionPane
        sortedSessions={sessions}
        selectedSessionId=""
        bookmarksCount={0}
        bookmarksSelected={false}
        collapsed={true}
        onToggleCollapsed={vi.fn()}
        onSelectBookmarks={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.queryByText("Bookmarked messages")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Sessions pane" })).toBeInTheDocument();
  });
});
