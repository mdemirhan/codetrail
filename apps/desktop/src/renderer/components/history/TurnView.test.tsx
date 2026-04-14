// @vitest-environment jsdom

import type { MessageCategory } from "@codetrail/core/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildTurnCategoryCounts, buildTurnVisibleMessages } from "../../features/turnViewModel";
import { CodetrailClientProvider } from "../../lib/codetrailClient";
import { PaneFocusProvider, useCreatePaneFocusController } from "../../lib/paneFocusController";
import { createMockCodetrailClient } from "../../test/mockCodetrailClient";
import { TurnView } from "./TurnView";

type TurnMessageStub = {
  id: string;
  sourceId: string;
  sessionId: string;
  provider: "claude" | "codex";
  category: MessageCategory;
  content: string;
  createdAt: string;
  tokenInput: number | null;
  tokenOutput: number | null;
  operationDurationMs: number | null;
  operationDurationSource: string | null;
  operationDurationConfidence: string | null;
  toolEditFiles?: Array<{
    filePath: string;
    previousFilePath: string | null;
    changeType: "add" | "update" | "delete" | "move";
    unifiedDiff: string | null;
    addedLineCount: number;
    removedLineCount: number;
    exactness: "exact" | "best_effort";
  }>;
};

type HistoryStub = {
  sessionTurnDetail: {
    session: null;
    anchorMessageId: string;
    anchorMessage: TurnMessageStub;
    turnNumber: number;
    totalTurns: number;
    previousTurnAnchorMessageId: string | null;
    nextTurnAnchorMessageId: string | null;
    firstTurnAnchorMessageId: string | null;
    latestTurnAnchorMessageId: string | null;
    totalCount: number;
    categoryCounts: Record<MessageCategory, number>;
    queryError: null;
    highlightPatterns: string[];
    matchedMessageIds?: string[] | undefined;
    messages: TurnMessageStub[];
  };
  effectiveTurnQuery: string;
  messagePathRoots: string[];
  focusMessageId: string;
  bookmarkedMessageIds: Set<string>;
  messageExpansionOverrides: Record<string, boolean>;
  turnViewCategories: MessageCategory[];
  turnViewExpandedByDefaultCategories: MessageCategory[];
  turnViewCombinedChangesExpanded: boolean;
  effectiveTurnCombinedChangesExpanded: boolean;
  combinedChangesDiffExpansionRequest: {
    expanded: boolean;
    version: number;
  } | null;
  turnVisibleMessages: TurnMessageStub[];
  activeHistoryMessages: TurnMessageStub[];
  turnCategoryCounts: Record<MessageCategory, number>;
  handleToggleVisibleCategoryMessagesExpandedInTurn: ReturnType<typeof vi.fn>;
  handleToggleMessageExpanded: ReturnType<typeof vi.fn>;
  handleToggleMessageExpandedInTurn: ReturnType<typeof vi.fn>;
  setTurnViewCombinedChangesExpanded: ReturnType<typeof vi.fn>;
  setTurnViewCombinedChangesExpandedOverride: ReturnType<typeof vi.fn>;
  handleCombinedChangesDiffStateChange: ReturnType<typeof vi.fn>;
  handleSelectMessagesView: ReturnType<typeof vi.fn>;
  handleToggleBookmark: ReturnType<typeof vi.fn>;
  handleRevealInSessionWithTurnExit: ReturnType<typeof vi.fn>;
  handleRevealInProjectWithTurnExit: ReturnType<typeof vi.fn>;
  handleRevealInBookmarksWithTurnExit: ReturnType<typeof vi.fn>;
  refs: {
    focusedMessageRef: { current: null };
  };
};

function createHistoryStub(): HistoryStub {
  return {
    sessionTurnDetail: {
      session: null,
      anchorMessageId: "message_1",
      anchorMessage: {
        id: "message_1",
        sourceId: "source_1",
        sessionId: "session_1",
        provider: "claude",
        category: "user",
        content: "Refactor turn history",
        createdAt: "2026-04-07T10:00:00.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      turnNumber: 1,
      totalTurns: 1,
      previousTurnAnchorMessageId: null,
      nextTurnAnchorMessageId: null,
      firstTurnAnchorMessageId: "message_1",
      latestTurnAnchorMessageId: "message_1",
      totalCount: 3,
      categoryCounts: {
        user: 1,
        assistant: 1,
        tool_use: 0,
        tool_edit: 1,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      queryError: null,
      highlightPatterns: [],
      messages: [
        {
          id: "message_3",
          sourceId: "source_3",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Turn view is ready.",
          createdAt: "2026-04-07T10:00:02.000Z",
          tokenInput: 10,
          tokenOutput: 5,
          operationDurationMs: 1000,
          operationDurationSource: "native",
          operationDurationConfidence: "high",
        },
        {
          id: "message_2",
          sourceId: "source_2",
          sessionId: "session_1",
          provider: "claude",
          category: "tool_edit",
          content: JSON.stringify({
            name: "Edit",
            input: {
              file_path: "/workspace/project-one/src/query.ts",
              old_string: "return stable;",
              new_string: "return turnStable;",
            },
          }),
          createdAt: "2026-04-07T10:00:01.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
        {
          id: "message_1",
          sourceId: "source_1",
          sessionId: "session_1",
          provider: "claude",
          category: "user",
          content: "Refactor turn history",
          createdAt: "2026-04-07T10:00:00.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      ],
    },
    effectiveTurnQuery: "",
    messagePathRoots: ["/workspace/project-one"],
    focusMessageId: "",
    bookmarkedMessageIds: new Set<string>(),
    messageExpansionOverrides: { message_1: true, message_2: false, message_3: false },
    turnViewCategories: ["user", "assistant", "tool_edit"] as MessageCategory[],
    turnViewExpandedByDefaultCategories: ["user", "assistant"] as MessageCategory[],
    turnViewCombinedChangesExpanded: false,
    effectiveTurnCombinedChangesExpanded: false,
    combinedChangesDiffExpansionRequest: null,
    turnVisibleMessages: [],
    activeHistoryMessages: [],
    turnCategoryCounts: {
      user: 1,
      assistant: 1,
      tool_use: 0,
      tool_edit: 1,
      tool_result: 0,
      thinking: 0,
      system: 0,
    },
    handleToggleVisibleCategoryMessagesExpandedInTurn: vi.fn(),
    handleToggleMessageExpanded: vi.fn(),
    handleToggleMessageExpandedInTurn: vi.fn(),
    setTurnViewCombinedChangesExpanded: vi.fn(),
    setTurnViewCombinedChangesExpandedOverride: vi.fn(),
    handleCombinedChangesDiffStateChange: vi.fn(),
    handleSelectMessagesView: vi.fn(),
    handleToggleBookmark: vi.fn(),
    handleRevealInSessionWithTurnExit: vi.fn(),
    handleRevealInProjectWithTurnExit: vi.fn(),
    handleRevealInBookmarksWithTurnExit: vi.fn(),
    refs: {
      focusedMessageRef: { current: null },
    },
  };
}

function replaceTurnMessage(history: HistoryStub, index: number, updates: Record<string, unknown>) {
  const currentMessage = history.sessionTurnDetail.messages[index] as Record<string, unknown>;
  history.sessionTurnDetail.messages[index] = {
    ...currentMessage,
    ...updates,
  } as never;
}

function cloneHistoryStub(history: HistoryStub): HistoryStub {
  return {
    ...history,
    bookmarkedMessageIds: new Set(history.bookmarkedMessageIds),
    messageExpansionOverrides: { ...history.messageExpansionOverrides },
    turnViewCategories: [...history.turnViewCategories],
    turnViewExpandedByDefaultCategories: [...history.turnViewExpandedByDefaultCategories],
    turnViewCombinedChangesExpanded: history.turnViewCombinedChangesExpanded,
    effectiveTurnCombinedChangesExpanded: history.effectiveTurnCombinedChangesExpanded,
    combinedChangesDiffExpansionRequest: history.combinedChangesDiffExpansionRequest,
    sessionTurnDetail: {
      ...history.sessionTurnDetail,
      categoryCounts: { ...history.sessionTurnDetail.categoryCounts },
      highlightPatterns: [...history.sessionTurnDetail.highlightPatterns],
      ...(history.sessionTurnDetail.matchedMessageIds
        ? { matchedMessageIds: [...history.sessionTurnDetail.matchedMessageIds] }
        : {}),
      messages: history.sessionTurnDetail.messages.map((message) => ({ ...message })),
    },
    turnVisibleMessages: history.turnVisibleMessages.map((message) => ({ ...message })),
    activeHistoryMessages: history.activeHistoryMessages.map((message) => ({ ...message })),
    turnCategoryCounts: { ...history.turnCategoryCounts },
  };
}

function syncTurnDerived(history: HistoryStub) {
  history.turnVisibleMessages = buildTurnVisibleMessages(
    history.sessionTurnDetail.messages,
    history.sessionTurnDetail.anchorMessage,
    history.turnViewCategories,
    history.sessionTurnDetail.matchedMessageIds,
  );
  history.turnCategoryCounts = buildTurnCategoryCounts(
    history.sessionTurnDetail.messages,
    history.sessionTurnDetail.anchorMessage,
  );
  history.activeHistoryMessages = history.sessionTurnDetail.messages.map((message) => ({
    ...message,
  }));
}

function renderTurnView(history: HistoryStub) {
  const client = createMockCodetrailClient();

  function Wrapper({ children }: { children: ReactNode }) {
    const controller = useCreatePaneFocusController();
    return (
      <CodetrailClientProvider value={client}>
        <PaneFocusProvider controller={controller}>{children}</PaneFocusProvider>
      </CodetrailClientProvider>
    );
  }

  function StatefulTurnView({
    history: nextHistory,
  }: {
    history: HistoryStub;
  }) {
    const [combinedExpanded, setCombinedExpanded] = useState(
      nextHistory.turnViewCombinedChangesExpanded,
    );
    const [combinedExpandedOverride, setCombinedExpandedOverride] = useState<boolean | null>(null);
    return (
      <TurnView
        history={
          {
            ...nextHistory,
            turnViewCombinedChangesExpanded: combinedExpanded,
            effectiveTurnCombinedChangesExpanded: combinedExpandedOverride ?? combinedExpanded,
            setTurnViewCombinedChangesExpanded: setCombinedExpanded,
            setTurnViewCombinedChangesExpandedOverride: setCombinedExpandedOverride,
          } as never
        }
      />
    );
  }

  const rendered = render(<StatefulTurnView history={history} />, { wrapper: Wrapper });
  return {
    ...rendered,
    rerenderHistory(nextHistory: HistoryStub) {
      rendered.rerender(<StatefulTurnView history={nextHistory} />);
    },
  };
}

describe("TurnView", () => {
  beforeEach(() => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "false";
  });

  it("renders the anchor user row first and combined changes second", () => {
    const history = createHistoryStub();
    syncTurnDerived(history);
    const { container } = renderTurnView(history);

    const rowTypes = Array.from(container.querySelectorAll(".message .msg-role")).map((node) =>
      node.textContent?.trim(),
    );
    expect(rowTypes[0]).toBe("User");
    expect(rowTypes[1]).toBe("Combined Changes");

    fireEvent.click(screen.getByRole("button", { name: "Collapse message" }));
    expect(history.handleToggleMessageExpandedInTurn).toHaveBeenCalledWith("message_1", "user");

    expect(container.querySelector(".message-preview .diff-meta-added")?.textContent).toBe("+1");
    expect(container.querySelector(".message-preview .diff-meta-removed")?.textContent).toBe("-1");

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(screen.getByText("1 file changed")).toBeInTheDocument();
    expect(container.querySelector(".tool-edit-summary .diff-meta-added")?.textContent).toBe("+1");
    expect(container.querySelector(".tool-edit-summary .diff-meta-removed")?.textContent).toBe(
      "-1",
    );
    expect(document.querySelectorAll(".turn-combined-file .content-viewer")).toHaveLength(1);
    expect(screen.queryByText("Best Effort")).toBeNull();
  });

  it("shows aggregate added and removed line counts in the combined changes summary", () => {
    const history = createHistoryStub();
    replaceTurnMessage(history, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/query.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/query.ts",
            "+++ b//workspace/project-one/src/query.ts",
            "@@ -1,2 +1,3 @@",
            "-const oldValue = 1;",
            "+const newValue = 2;",
            "+const newerValue = 3;",
          ].join("\n"),
          addedLineCount: 2,
          removedLineCount: 1,
          exactness: "exact",
        },
        {
          filePath: "/workspace/project-one/src/other.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/other.ts",
            "+++ b//workspace/project-one/src/other.ts",
            "@@ -1,2 +1,4 @@",
            "-const firstOld = true;",
            "-const secondOld = false;",
            "+const firstNew = true;",
            "+const secondNew = false;",
            "+const thirdNew = maybe;",
          ].join("\n"),
          addedLineCount: 3,
          removedLineCount: 2,
          exactness: "exact",
        },
      ],
    });
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    expect(screen.getByText("2 files changed")).toBeInTheDocument();
    expect(container.querySelector(".message-preview .diff-meta-added")?.textContent).toBe("+5");
    expect(container.querySelector(".message-preview .diff-meta-removed")?.textContent).toBe("-3");

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(container.querySelector(".tool-edit-summary .diff-meta-added")?.textContent).toBe("+5");
    expect(container.querySelector(".tool-edit-summary .diff-meta-removed")?.textContent).toBe(
      "-3",
    );
  });

  it("renders combined changes first when the user category is hidden", () => {
    const history = createHistoryStub();
    history.turnViewCategories = ["assistant", "tool_edit"] as MessageCategory[];
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    const rowTypes = Array.from(container.querySelectorAll(".message .msg-role")).map((node) =>
      node.textContent?.trim(),
    );
    expect(rowTypes[0]).toBe("Combined Changes");
    expect(rowTypes[1]).toBe("Assistant");
    expect(rowTypes).not.toContain("User");
  });

  it("pins the anchor user row first even when the visible message order arrives differently", () => {
    const history = createHistoryStub();
    syncTurnDerived(history);
    history.turnVisibleMessages = [
      history.sessionTurnDetail.messages[0]!,
      history.sessionTurnDetail.messages[1]!,
      history.sessionTurnDetail.messages[2]!,
    ];

    const { container } = renderTurnView(history);

    const rowTypes = Array.from(container.querySelectorAll(".message .msg-role")).map((node) =>
      node.textContent?.trim(),
    );
    expect(rowTypes[0]).toBe("User");
    expect(rowTypes[1]).toBe("Combined Changes");
  });

  it("uses the earliest visible user row as the display anchor when the stored anchor is system", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.anchorMessageId = "message_0";
    history.sessionTurnDetail.anchorMessage = {
      id: "message_0",
      sourceId: "source_0",
      sessionId: "session_1",
      provider: "codex",
      category: "system",
      content: "# AGENTS.md instructions",
      createdAt: "2026-04-07T09:59:59.000Z",
      tokenInput: null,
      tokenOutput: null,
      operationDurationMs: null,
      operationDurationSource: null,
      operationDurationConfidence: null,
    };
    history.sessionTurnDetail.messages = [
      history.sessionTurnDetail.anchorMessage,
      ...history.sessionTurnDetail.messages.map((message) => ({
        ...message,
        provider: "codex" as const,
      })),
    ];
    history.sessionTurnDetail.totalCount = 4;
    history.sessionTurnDetail.categoryCounts.system = 1;
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    const rowTypes = Array.from(container.querySelectorAll(".message .msg-role")).map((node) =>
      node.textContent?.trim(),
    );
    expect(rowTypes[0]).toBe("User");
    expect(rowTypes[1]).toBe("Combined Changes");
    expect(screen.getByText("Refactor turn history")).toBeInTheDocument();
  });

  it("shows an empty-turn explanation and flat CTA when flat messages exist", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.anchorMessageId = null as never;
    history.sessionTurnDetail.anchorMessage = null as never;
    history.sessionTurnDetail.turnNumber = 0;
    history.sessionTurnDetail.totalTurns = 0;
    history.sessionTurnDetail.totalCount = 0;
    history.sessionTurnDetail.messages = [];
    history.turnVisibleMessages = [];
    history.activeHistoryMessages = [
      {
        id: "flat_1",
        sourceId: "flat_source_1",
        sessionId: "session_1",
        provider: "codex",
        category: "assistant",
        content: "Still has flat messages",
        createdAt: "2026-04-07T10:00:00.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
    ];

    renderTurnView(history);

    expect(
      screen.getByText("No user messages in this scope, so there are no turns yet."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Flat view" }));
    expect(history.handleSelectMessagesView).toHaveBeenCalledTimes(1);
  });

  it("shows a no-messages empty state without a flat CTA when the scope is empty", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.anchorMessageId = null as never;
    history.sessionTurnDetail.anchorMessage = null as never;
    history.sessionTurnDetail.turnNumber = 0;
    history.sessionTurnDetail.totalTurns = 0;
    history.sessionTurnDetail.totalCount = 0;
    history.sessionTurnDetail.messages = [];
    history.turnVisibleMessages = [];
    history.activeHistoryMessages = [];

    renderTurnView(history);

    expect(screen.getByText("No messages in this scope yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to Flat view" })).toBeNull();
  });

  it("uses the global multi-file diff collapse preference for combined changes", () => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    const history = createHistoryStub();
    replaceTurnMessage(history, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/query.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/query.ts",
            "+++ b//workspace/project-one/src/query.ts",
            "@@ -1,1 +1,1 @@",
            "-return stable;",
            "+return turnStable;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "exact",
        },
        {
          filePath: "/workspace/project-one/src/other.ts",
          previousFilePath: null,
          changeType: "delete",
          unifiedDiff: [
            "--- a//workspace/project-one/src/other.ts",
            "+++ /dev/null",
            "@@ -1,1 +0,0 @@",
            "-export const removed = true;",
          ].join("\n"),
          addedLineCount: 0,
          removedLineCount: 1,
          exactness: "best_effort",
        },
      ],
    });
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(screen.getByRole("button", { name: "Expand Diffs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Diffs" }));
    expect(container.querySelectorAll(".diff-sequence-marker")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Collapse diff for other.ts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Combined" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sequence" })).toBeNull();
  });

  it("uses the same collapse preference for a single combined diff file", () => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    const history = createHistoryStub();
    replaceTurnMessage(history, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/query.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/query.ts",
            "+++ b//workspace/project-one/src/query.ts",
            "@@ -1,1 +1,1 @@",
            "-return stable;",
            "+return turnStable;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "exact",
        },
      ],
    });
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(screen.getByRole("button", { name: "Expand diff for query.ts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse diff for query.ts" })).toBeNull();
  });

  it("applies visible diff expansion requests to expanded combined changes", () => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    const history = createHistoryStub();
    replaceTurnMessage(history, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/query.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/query.ts",
            "+++ b//workspace/project-one/src/query.ts",
            "@@ -1,1 +1,1 @@",
            "-return stable;",
            "+return turnStable;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "exact",
        },
        {
          filePath: "/workspace/project-one/src/other.ts",
          previousFilePath: null,
          changeType: "delete",
          unifiedDiff: [
            "--- a//workspace/project-one/src/other.ts",
            "+++ /dev/null",
            "@@ -1,1 +0,0 @@",
            "-export const removed = true;",
          ].join("\n"),
          addedLineCount: 0,
          removedLineCount: 1,
          exactness: "best_effort",
        },
      ],
    });
    syncTurnDerived(history);

    const { rerenderHistory } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));
    expect(screen.getByRole("button", { name: "Expand Diffs" })).toBeInTheDocument();

    const nextHistory = cloneHistoryStub(history);
    nextHistory.turnViewCombinedChangesExpanded = true;
    nextHistory.effectiveTurnCombinedChangesExpanded = true;
    nextHistory.combinedChangesDiffExpansionRequest = {
      expanded: true,
      version: 1,
    };
    rerenderHistory(nextHistory);

    expect(screen.getAllByRole("button", { name: "Collapse Diffs" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Collapse diff for other.ts" })).toBeInTheDocument();
  });

  it("keeps combined changes collapsed while applying hidden diff expansion requests", () => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    const history = createHistoryStub();
    replaceTurnMessage(history, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/query.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/query.ts",
            "+++ b//workspace/project-one/src/query.ts",
            "@@ -1,1 +1,1 @@",
            "-return stable;",
            "+return turnStable;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "exact",
        },
        {
          filePath: "/workspace/project-one/src/other.ts",
          previousFilePath: null,
          changeType: "delete",
          unifiedDiff: [
            "--- a//workspace/project-one/src/other.ts",
            "+++ /dev/null",
            "@@ -1,1 +0,0 @@",
            "-export const removed = true;",
          ].join("\n"),
          addedLineCount: 0,
          removedLineCount: 1,
          exactness: "best_effort",
        },
      ],
    });
    syncTurnDerived(history);

    const { rerenderHistory } = renderTurnView(history);
    expect(screen.getByRole("button", { name: /expand combined changes/i })).toBeInTheDocument();

    const nextHistory = cloneHistoryStub(history);
    nextHistory.combinedChangesDiffExpansionRequest = {
      expanded: true,
      version: 1,
    };
    rerenderHistory(nextHistory);

    expect(screen.getByRole("button", { name: /expand combined changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));
    expect(screen.getByRole("button", { name: "Collapse diff for other.ts" })).toBeInTheDocument();
  });

  it("applies combined diff collapse requests after the section is already open", () => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    const history = createHistoryStub();
    replaceTurnMessage(history, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/query.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/query.ts",
            "+++ b//workspace/project-one/src/query.ts",
            "@@ -1,1 +1,1 @@",
            "-return stable;",
            "+return turnStable;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "exact",
        },
        {
          filePath: "/workspace/project-one/src/other.ts",
          previousFilePath: null,
          changeType: "delete",
          unifiedDiff: [
            "--- a//workspace/project-one/src/other.ts",
            "+++ /dev/null",
            "@@ -1,1 +0,0 @@",
            "-export const removed = true;",
          ].join("\n"),
          addedLineCount: 0,
          removedLineCount: 1,
          exactness: "best_effort",
        },
      ],
    });
    syncTurnDerived(history);

    const { rerenderHistory } = renderTurnView(history);
    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));
    expect(screen.getByRole("button", { name: "Expand Diffs" })).toBeInTheDocument();

    const expandedHistory = cloneHistoryStub(history);
    expandedHistory.turnViewCombinedChangesExpanded = true;
    expandedHistory.effectiveTurnCombinedChangesExpanded = true;
    expandedHistory.combinedChangesDiffExpansionRequest = {
      expanded: true,
      version: 1,
    };
    rerenderHistory(expandedHistory);
    expect(
      screen
        .getAllByRole("button", { name: "Collapse Diffs" })
        .some((button) => button.getAttribute("title")?.includes("⌘D / ⌘⇧D")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Collapse diff for other.ts" })).toBeInTheDocument();

    const collapsedHistory = cloneHistoryStub(expandedHistory);
    collapsedHistory.combinedChangesDiffExpansionRequest = {
      expanded: false,
      version: 2,
    };
    rerenderHistory(collapsedHistory);
    expect(
      screen
        .getAllByRole("button", { name: "Expand Diffs" })
        .some((button) => button.getAttribute("title")?.includes("⌘⇧D")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Expand diff for other.ts" })).toBeInTheDocument();
  });

  it("renders multi-edit files in one diff viewer with sequence separators", () => {
    const history = createHistoryStub();
    history.messagePathRoots = ["/workspace/project-one"];
    history.sessionTurnDetail.messages = [
      {
        id: "message_3",
        sourceId: "source_3",
        sessionId: "session_1",
        provider: "codex",
        category: "tool_edit",
        content: JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/controller.ts",
            "@@",
            " function loadValue() {",
            '-  return "mid";',
            '+  return "new";',
            " }",
            "*** End Patch",
          ].join("\n"),
        }),
        createdAt: "2026-04-07T10:00:02.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      {
        id: "message_2",
        sourceId: "source_2",
        sessionId: "session_1",
        provider: "codex",
        category: "tool_edit",
        content: JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/controller.ts",
            "@@",
            " function loadValue() {",
            '-  return "old";',
            '+  return "mid";',
            " }",
            "*** End Patch",
          ].join("\n"),
        }),
        createdAt: "2026-04-07T10:00:01.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      history.sessionTurnDetail.anchorMessage,
    ];
    history.sessionTurnDetail.totalCount = history.sessionTurnDetail.messages.length;
    history.messageExpansionOverrides = { message_1: true, message_2: false, message_3: false };
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(container.querySelectorAll(".diff-sequence-marker")).toHaveLength(2);
    expect(container.textContent).toContain("Edit 1 of 2");
    expect(container.textContent).toContain("Edit 2 of 2");
    expect(screen.getAllByText("src/controller.ts").length).toBeGreaterThan(0);
    expect(screen.queryByText("/workspace/project-one/src/controller.ts")).toBeNull();
    expect(screen.queryByText("PLAIN")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Split" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Collapse diff for controller.ts" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Wrap" })).toHaveLength(1);
    expect(container.textContent).not.toContain("========= Edit 1");
    expect(screen.queryByRole("button", { name: "Combined" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sequence" })).toBeNull();
  });

  it("preserves expanded combined file diffs when new turn messages arrive", () => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    const history = createHistoryStub();
    const initialFiles = [
      {
        filePath: "/workspace/project-one/src/query.ts",
        previousFilePath: null,
        changeType: "update",
        unifiedDiff: [
          "--- a//workspace/project-one/src/query.ts",
          "+++ b//workspace/project-one/src/query.ts",
          "@@ -1,1 +1,1 @@",
          "-return stable;",
          "+return turnStable;",
        ].join("\n"),
        addedLineCount: 1,
        removedLineCount: 1,
        exactness: "exact",
      },
    ];
    replaceTurnMessage(history, 1, {
      toolEditFiles: initialFiles,
    });
    syncTurnDerived(history);

    const { rerenderHistory } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));
    fireEvent.click(screen.getByRole("button", { name: "Expand diff for query.ts" }));
    expect(screen.getByRole("button", { name: "Collapse diff for query.ts" })).toBeInTheDocument();

    const updatedHistory = cloneHistoryStub(history);
    replaceTurnMessage(updatedHistory, 1, {
      toolEditFiles: [
        ...initialFiles,
        {
          filePath: "/workspace/project-one/src/other.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/other.ts",
            "+++ b//workspace/project-one/src/other.ts",
            "@@ -1,1 +1,1 @@",
            "-export const removed = false;",
            "+export const removed = true;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "exact",
        },
      ],
    });
    syncTurnDerived(updatedHistory);

    rerenderHistory(updatedHistory);

    expect(screen.getByRole("button", { name: "Collapse diff for query.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand diff for other.ts" })).toBeInTheDocument();
  });

  it("does not render representation controls when navigating between turns", () => {
    const firstTurn = createHistoryStub();
    firstTurn.turnViewCombinedChangesExpanded = true;
    firstTurn.effectiveTurnCombinedChangesExpanded = true;
    replaceTurnMessage(firstTurn, 1, {
      toolEditFiles: [
        {
          filePath: "/workspace/project-one/src/controller.ts",
          previousFilePath: null,
          changeType: "update",
          unifiedDiff: [
            "--- a//workspace/project-one/src/controller.ts",
            "+++ b//workspace/project-one/src/controller.ts",
            "@@ -1,1 +1,1 @@",
            "-export const beforeValue = 1;",
            "+export const afterValue = 2;",
          ].join("\n"),
          addedLineCount: 1,
          removedLineCount: 1,
          exactness: "best_effort",
        },
      ],
    });
    syncTurnDerived(firstTurn);

    const { rerenderHistory } = renderTurnView(firstTurn);

    expect(screen.queryByRole("button", { name: "Combined" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sequence" })).toBeNull();

    const secondTurn = cloneHistoryStub(firstTurn);
    secondTurn.sessionTurnDetail.anchorMessageId = "message_turn_2";
    secondTurn.sessionTurnDetail.anchorMessage = {
      ...secondTurn.sessionTurnDetail.anchorMessage,
      id: "message_turn_2",
      sourceId: "source_turn_2",
      content: "Next turn",
      createdAt: "2026-04-07T10:05:00.000Z",
    };
    secondTurn.sessionTurnDetail.messages = [
      {
        id: "message_turn_2_edit_2",
        sourceId: "source_turn_2_edit_2",
        sessionId: "session_1",
        provider: "codex",
        category: "tool_edit",
        content: JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/controller.ts",
            "@@",
            " function loadValue() {",
            '-  return "mid";',
            '+  return "new";',
            " }",
            "*** End Patch",
          ].join("\n"),
        }),
        createdAt: "2026-04-07T10:05:02.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      {
        id: "message_turn_2_edit_1",
        sourceId: "source_turn_2_edit_1",
        sessionId: "session_1",
        provider: "codex",
        category: "tool_edit",
        content: JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/controller.ts",
            "@@",
            " function loadValue() {",
            '-  return "old";',
            '+  return "mid";',
            " }",
            "*** End Patch",
          ].join("\n"),
        }),
        createdAt: "2026-04-07T10:05:01.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      secondTurn.sessionTurnDetail.anchorMessage,
    ];
    secondTurn.sessionTurnDetail.totalCount = secondTurn.sessionTurnDetail.messages.length;
    secondTurn.messageExpansionOverrides = {
      message_turn_2: true,
      message_turn_2_edit_1: false,
      message_turn_2_edit_2: false,
    };
    syncTurnDerived(secondTurn);

    rerenderHistory(secondTurn);
    expect(screen.queryByRole("button", { name: "Combined" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sequence" })).toBeNull();
    expect(document.querySelectorAll(".diff-sequence-marker")).toHaveLength(2);

    rerenderHistory(firstTurn);
    expect(screen.queryByRole("button", { name: "Combined" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sequence" })).toBeNull();
  });

  it("keeps combined changes sourced from the full turn when the timeline is filtered", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.matchedMessageIds = ["message_3"];
    syncTurnDerived(history);

    renderTurnView(history);

    expect(history.turnVisibleMessages.map((message) => message.id)).toEqual([
      "message_1",
      "message_3",
    ]);
    expect(screen.getByText("1 file changed")).toBeInTheDocument();
  });

  it("ignores tool_result diff output in combined changes", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.messages = [
      {
        id: "message_3",
        sourceId: "source_3",
        sessionId: "session_1",
        provider: "claude",
        category: "tool_result",
        content: [
          "1\tdiff --git a/apps/desktop/src/main/data/queryService.ts b/apps/desktop/src/main/data/queryService.ts",
          "2\tindex 1111111..2222222 100644",
          "3\t--- a/apps/desktop/src/main/data/queryService.ts",
          "4\t+++ b/apps/desktop/src/main/data/queryService.ts",
          "5\t@@ -1,1 +1,1 @@",
          "6\t-const before = true;",
          "7\t+const after = true;",
        ].join("\n"),
        createdAt: "2026-04-07T10:00:02.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      history.sessionTurnDetail.anchorMessage,
    ];
    history.sessionTurnDetail.totalCount = history.sessionTurnDetail.messages.length;
    history.messageExpansionOverrides = { message_1: true, message_3: false };
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(container.querySelector(".turn-combined-file .diff-table")).toBeNull();
    expect(container.querySelector(".turn-combined-card.is-empty")).not.toBeNull();
    expect(screen.getByText("No file changes in this turn.")).toBeInTheDocument();
  });

  it("does not show all timeline messages when turn search has zero matches", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.matchedMessageIds = [];
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    const rowTypes = Array.from(container.querySelectorAll(".message .msg-role")).map((node) =>
      node.textContent?.trim(),
    );
    expect(rowTypes).toEqual(["User", "Combined Changes"]);
    expect(history.turnVisibleMessages.map((message) => message.id)).toEqual(["message_1"]);
  });

  it("renders Copilot path-only edits as best-effort combined file entries", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.messages = [
      {
        id: "message_2",
        sourceId: "source_2",
        sessionId: "session_1",
        provider: "copilot" as never,
        category: "tool_edit",
        content: JSON.stringify({
          type: "tool_use",
          name: "editFile",
          input: {
            path: "src/parser.ts",
            operation: "write",
          },
        }),
        createdAt: "2026-04-07T10:00:01.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      history.sessionTurnDetail.anchorMessage,
    ];
    history.sessionTurnDetail.totalCount = history.sessionTurnDetail.messages.length;
    history.messageExpansionOverrides = { message_1: true, message_2: false };
    syncTurnDerived(history);

    const { container } = renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(screen.getByText("1 file changed")).toBeInTheDocument();
    expect(container.textContent).toContain(
      "Updated file via Copilot. Exact diff unavailable in session payload.",
    );
    expect(container.querySelector(".turn-combined-card.is-empty")).toBeNull();
  });

  it("reduces combined changes chronologically even when turn messages are newest-first", () => {
    const history = createHistoryStub();
    history.sessionTurnDetail.messages = [
      {
        id: "message_4",
        sourceId: "source_4",
        sessionId: "session_1",
        provider: "claude",
        category: "tool_edit",
        content: JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/useHistoryController.ts",
            "@@",
            " const sortDir = activeMessageSortDirection;",
            "+const sortDir = turnViewSortDirection;",
            "*** End Patch",
          ].join("\n"),
        }),
        createdAt: "2026-04-07T10:00:03.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      {
        id: "message_3",
        sourceId: "source_3",
        sessionId: "session_1",
        provider: "claude",
        category: "tool_edit",
        content: JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/useHistoryController.ts",
            "@@",
            ' import { useHistoryViewportEffects } from "./useHistoryViewportEffects";',
            '+import { buildTurnVisibleMessages } from "./turnViewModel";',
            "*** End Patch",
          ].join("\n"),
        }),
        createdAt: "2026-04-07T10:00:02.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      history.sessionTurnDetail.anchorMessage,
    ];
    history.sessionTurnDetail.totalCount = history.sessionTurnDetail.messages.length;
    history.messageExpansionOverrides = { message_1: true, message_3: false, message_4: false };
    syncTurnDerived(history);

    renderTurnView(history);

    fireEvent.click(screen.getByRole("button", { name: /expand combined changes/i }));

    expect(screen.getByText(/buildTurnVisibleMessages/, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/turnViewSortDirection/, { exact: false })).toBeInTheDocument();
  });
});
