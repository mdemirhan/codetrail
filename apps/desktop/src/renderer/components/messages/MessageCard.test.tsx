// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { copyTextToClipboard } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../../lib/clipboard", () => ({
  copyTextToClipboard,
}));

import { renderWithPaneFocus } from "../../test/renderWithPaneFocus";
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
  turnGroupId: null,
  turnGroupingMode: "heuristic",
  turnAnchorKind: null,
  nativeTurnId: null,
};

describe("MessageCard", () => {
  beforeEach(() => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "false";
  });

  it("renders expanded message and handles action buttons", async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();
    const onToggleBookmark = vi.fn();
    const onRevealInSession = vi.fn();
    const onRevealInProject = vi.fn();
    const onRevealInBookmarks = vi.fn();
    const onRevealInTurn = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={message}
        query=""
        pathRoots={[]}
        isFocused={false}
        isBookmarked={false}
        isOrphaned={true}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
        onToggleBookmark={onToggleBookmark}
        onRevealInSession={onRevealInSession}
        onRevealInProject={onRevealInProject}
        onRevealInBookmarks={onRevealInBookmarks}
        onRevealInTurn={onRevealInTurn}
      />,
    );

    expect(screen.getByText("Assistant response body")).toBeInTheDocument();
    expect(screen.getByText("Took: ~5s")).toBeInTheDocument();
    expect(screen.getByText("Orphaned")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse message" }));
    await user.click(screen.getByRole("button", { name: "Copy formatted message body" }));
    await user.click(screen.getByRole("button", { name: "Reveal this message in session" }));
    await user.click(screen.getByRole("button", { name: "Reveal this message in project" }));
    await user.click(screen.getByRole("button", { name: "Reveal this message in bookmarks" }));
    await user.click(screen.getByRole("button", { name: "Reveal this message in turn" }));
    await user.click(screen.getByRole("button", { name: "Bookmark this message" }));

    expect(onToggleExpanded).toHaveBeenCalledWith("message_1", "assistant");
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1);
    expect(onRevealInSession).toHaveBeenCalledWith("message_1", "source_1");
    expect(onRevealInProject).toHaveBeenCalledWith("message_1", "source_1", "session_1");
    expect(onRevealInBookmarks).toHaveBeenCalledWith("message_1", "source_1");
    expect(onRevealInTurn).toHaveBeenCalledWith(message);
    expect(onToggleBookmark).toHaveBeenCalledWith(message);
  });

  it("renders collapsed state without optional actions", async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_use",
          content: JSON.stringify({
            tool_name: "Read",
            input: { file_path: "/Users/tcmudemirhan/project/src/app.ts" },
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={true}
        isBookmarked={true}
        isExpanded={false}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.getByText(/Tool Use:/)).toBeInTheDocument();
    expect(screen.getByText("Read ~/project/src/app.ts")).toBeInTheDocument();
    expect(screen.queryByText("Assistant response body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reveal this message in bookmarks" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand message" }));
    expect(onToggleExpanded).toHaveBeenCalled();
  });

  it("summarizes multi-file tool edits in the collapsed preview", () => {
    const onToggleExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_edit",
          content: JSON.stringify({
            name: "apply_patch",
            input: [
              "*** Begin Patch",
              "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
              "+export const created = true;",
              "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
              "@@",
              "-const value = old();",
              "+const value = next();",
              "*** Update File: /Users/tcmudemirhan/project/src/third.ts",
              "@@",
              "-old",
              "+next",
              "*** Update File: /Users/tcmudemirhan/project/src/fourth.ts",
              "@@",
              "-before",
              "+after",
              "*** End Patch",
            ].join("\n"),
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={false}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.getByText("Write 1 file added, 3 files changed")).toBeInTheDocument();
  });

  it("toggles all write diffs from the message header action", async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_edit",
          content: JSON.stringify({
            name: "apply_patch",
            input: [
              "*** Begin Patch",
              "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
              "+export const created = true;",
              "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
              "@@",
              "-const value = old();",
              "+const value = next();",
              "*** End Patch",
            ].join("\n"),
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse Diffs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse diff for parser.ts" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse Diffs" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand Diffs" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Expand Diffs" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse Diffs" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Collapse diff for parser.ts" }),
      ).toBeInTheDocument();
      expect(document.body.textContent).toContain("const value = next();");
    });
  });

  it("starts multi-file diff cards collapsed when the setting is enabled", () => {
    const onToggleExpanded = vi.fn();
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_edit",
          content: JSON.stringify({
            name: "apply_patch",
            input: [
              "*** Begin Patch",
              "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
              "+export const created = true;",
              "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
              "@@",
              "-const value = old();",
              "+const value = next();",
              "*** End Patch",
            ].join("\n"),
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand Diffs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand diff for new.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("export const created = true;");
    expect(document.body.textContent).not.toContain("const value = next();");
  });

  it("preserves manual per-file diff choices across collapsing and reopening the message", async () => {
    const toolEditMessage: SessionMessage = {
      ...message,
      category: "tool_edit",
      content: JSON.stringify({
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
          "+export const created = true;",
          "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
          "@@",
          "-const value = old();",
          "+const value = next();",
          "*** End Patch",
        ].join("\n"),
      }),
    };

    const { rerender } = renderWithPaneFocus(
      <MessageCard
        message={toolEditMessage}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={vi.fn()}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Collapse diff for parser.ts" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse diff for new.ts" })).toBeInTheDocument();
    });

    rerender(
      <MessageCard
        message={toolEditMessage}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={false}
        onToggleExpanded={vi.fn()}
      />,
    );

    rerender(
      <MessageCard
        message={toolEditMessage}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse diff for new.ts" })).toBeInTheDocument();
    });
  });

  it("preserves existing write diff choices when a new file appears", async () => {
    const baseMessage: SessionMessage = {
      ...message,
      category: "tool_edit",
      content: JSON.stringify({
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
          "+export const created = true;",
          "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
          "@@",
          "-const value = old();",
          "+const value = next();",
          "*** End Patch",
        ].join("\n"),
      }),
    };
    const nextMessage: SessionMessage = {
      ...baseMessage,
      content: JSON.stringify({
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
          "+export const created = true;",
          "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
          "@@",
          "-const value = old();",
          "+const value = next();",
          "*** Update File: /Users/tcmudemirhan/project/src/third.ts",
          "@@",
          "-before",
          "+after",
          "*** End Patch",
        ].join("\n"),
      }),
    };

    const { rerender } = renderWithPaneFocus(
      <MessageCard
        message={baseMessage}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={vi.fn()}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Collapse diff for parser.ts" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
    });

    rerender(
      <MessageCard
        message={nextMessage}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse diff for new.ts" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Collapse diff for third.ts" }),
      ).toBeInTheDocument();
    });
  });

  it("opens newly mounted write cards with their normal diff defaults", async () => {
    const toolEditMessage: SessionMessage = {
      ...message,
      category: "tool_edit",
      content: JSON.stringify({
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
          "+export const created = true;",
          "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
          "@@",
          "-const value = old();",
          "+const value = next();",
          "*** End Patch",
        ].join("\n"),
      }),
    };

    renderWithPaneFocus(
      <MessageCard
        message={toolEditMessage}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse Diffs" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Collapse diff for parser.ts" }),
      ).toBeInTheDocument();
    });
  });

  it("shows the header diff toggle for single-file diff messages", () => {
    const onToggleExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_edit",
          content: JSON.stringify({
            input: {
              path: "/Users/tcmudemirhan/project/src/file.ts",
              old_string: "const beforeValue = 1;",
              new_string: "const afterValue = 2;",
            },
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse Diffs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse diff for file.ts" })).toBeInTheDocument();
  });

  it("does not show the header diff toggle for single-file write-only messages", () => {
    const onToggleExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_edit",
          content: JSON.stringify({
            input: {
              path: "/Users/tcmudemirhan/project/src/file.ts",
              content: "export const value = 1;",
            },
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.queryByRole("button", { name: "Collapse Diffs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand Diffs" })).toBeNull();
  });

  it("applies the global header toggle after individual diff changes", async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={{
          ...message,
          category: "tool_edit",
          content: JSON.stringify({
            name: "apply_patch",
            input: [
              "*** Begin Patch",
              "*** Add File: /Users/tcmudemirhan/project/src/new.ts",
              "+export const created = true;",
              "*** Update File: /Users/tcmudemirhan/project/src/parser.ts",
              "@@",
              "-const value = old();",
              "+const value = next();",
              "*** End Patch",
            ].join("\n"),
          }),
        }}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse diff for parser.ts" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("const value = next();");
      expect(document.body.textContent).toContain("export const created = true;");
    });

    await user.click(screen.getByRole("button", { name: "Expand Diffs" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse Diffs" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse diff for new.ts" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Collapse diff for parser.ts" }),
      ).toBeInTheDocument();
      expect(document.body.textContent).toContain("export const created = true;");
      expect(document.body.textContent).toContain("const value = next();");
    });

    await user.click(screen.getByRole("button", { name: "Collapse Diffs" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand Diffs" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand diff for new.ts" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("export const created = true;");
      expect(document.body.textContent).not.toContain("const value = next();");
    });
  });

  it("uses Cmd+click to toggle all messages of the same type", async () => {
    const onToggleExpanded = vi.fn();
    const onToggleCategoryExpanded = vi.fn();

    renderWithPaneFocus(
      <MessageCard
        message={message}
        query=""
        pathRoots={[]}
        isFocused={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
        onToggleCategoryExpanded={onToggleCategoryExpanded}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse message" }), { metaKey: true });

    expect(onToggleCategoryExpanded).toHaveBeenCalledWith("assistant");
    expect(onToggleExpanded).not.toHaveBeenCalled();
  });

  it("exports default expansion behavior", () => {
    expect(isMessageExpandedByDefault("user")).toBe(true);
    expect(isMessageExpandedByDefault("assistant")).toBe(true);
    expect(isMessageExpandedByDefault("tool_use")).toBe(false);
  });
});
