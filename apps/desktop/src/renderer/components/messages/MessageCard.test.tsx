// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { copyTextToClipboard } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../../lib/clipboard", () => ({
  copyTextToClipboard,
}));

import { MessageCard, isMessageExpandedByDefault } from "./MessageCard";
import type { SessionMessage } from "./types";

const message: SessionMessage = {
  id: "message_1",
  sourceId: "source_1",
  sessionId: "session_1",
  provider: "claude",
  category: "assistant",
  content: "Assistant response body",
  createdAt: "2026-03-01T10:00:05.000Z",
  tokenInput: 10,
  tokenOutput: 8,
  operationDurationMs: 5000,
  operationDurationSource: "native",
  operationDurationConfidence: "high",
};

describe("MessageCard", () => {
  it("renders expanded message and handles action buttons", async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();
    const onToggleFocused = vi.fn();
    const onToggleBookmark = vi.fn();
    const onRevealInSession = vi.fn();

    render(
      <MessageCard
        message={message}
        query=""
        pathRoots={[]}
        isFocused={false}
        isBookmarked={false}
        isOrphaned={true}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
        onToggleFocused={onToggleFocused}
        onToggleBookmark={onToggleBookmark}
        onRevealInSession={onRevealInSession}
      />,
    );

    expect(screen.getByText("Assistant response body")).toBeInTheDocument();
    expect(screen.getByText("Took: ~5s")).toBeInTheDocument();
    expect(screen.getByText("Orphaned")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse message" }));
    await user.click(screen.getByRole("button", { name: "Copy formatted message body" }));
    await user.click(screen.getByRole("button", { name: "Copy raw message data" }));
    await user.click(screen.getByRole("button", { name: "Focus this message" }));
    await user.click(screen.getByRole("button", { name: "Reveal this message in session" }));
    await user.click(screen.getByRole("button", { name: "Bookmark this message" }));

    expect(onToggleExpanded).toHaveBeenCalledWith("message_1", "assistant");
    expect(copyTextToClipboard).toHaveBeenCalledTimes(2);
    expect(onToggleFocused).toHaveBeenCalledWith("message_1");
    expect(onRevealInSession).toHaveBeenCalledWith("message_1", "source_1");
    expect(onToggleBookmark).toHaveBeenCalledWith(message);
  });

  it("renders collapsed state without optional actions", async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();

    render(
      <MessageCard
        message={{
          ...message,
          category: "tool_use",
          content: JSON.stringify({ tool_name: "Read" }),
        }}
        query=""
        pathRoots={[]}
        isFocused={true}
        isBookmarked={true}
        isExpanded={false}
        onToggleExpanded={onToggleExpanded}
        onToggleFocused={vi.fn()}
      />,
    );

    expect(screen.getByText(/Tool Use:/)).toBeInTheDocument();
    expect(screen.queryByText("Assistant response body")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand message" }));
    expect(onToggleExpanded).toHaveBeenCalled();
  });

  it("exports default expansion behavior", () => {
    expect(isMessageExpandedByDefault("user")).toBe(true);
    expect(isMessageExpandedByDefault("assistant")).toBe(true);
    expect(isMessageExpandedByDefault("tool_use")).toBe(false);
  });
});
