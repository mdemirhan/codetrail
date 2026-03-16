import { useCallback } from "react";
import type {
  Dispatch,
  MutableRefObject,
  KeyboardEvent as ReactKeyboardEvent,
  UIEvent as ReactUIEvent,
  RefObject,
  SetStateAction,
} from "react";

import type { RefreshContext } from "./useHistoryController";

import type { MessageCategory } from "@codetrail/core";

import { BOOKMARKS_NAV_ID, PAGE_SIZE, PROJECT_ALL_NAV_ID, PROVIDERS } from "../app/constants";
import { createHistorySelection, setHistorySelectionProjectId } from "../app/historySelection";
import type {
  BulkExpandScope,
  HistoryMessage,
  HistorySearchNavigation,
  HistorySelection,
  PendingMessagePageNavigation,
  PendingRevealTarget,
  ProjectSummary,
  SessionPaneNavigationItem,
  SessionSummary,
} from "../app/types";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  type Direction,
  getAdjacentItemId,
  getFirstVisibleMessageId,
} from "../lib/historyNavigation";
import { deriveSessionTitle, toggleValue } from "../lib/viewUtils";
import { focusHistoryList, formatDuration } from "./historyControllerShared";

// Interaction handlers are collected here so keyboard/mouse behavior can share the same
// state-transition rules without being spread across components.
export function useHistoryInteractions({
  codetrail,
  logError,
  scopedMessages,
  areScopedMessagesExpanded,
  setMessageExpanded,
  setHistoryCategories,
  setSessionPage,
  isExpandedByDefault,
  historyMode,
  bookmarksResponse,
  activeHistoryMessages,
  selectedProjectId,
  historyCategories,
  setPendingSearchNavigation,
  setSessionQueryInput,
  setFocusMessageId,
  setPendingRevealTarget,
  loadBookmarks,
  sessionScrollTopRef,
  sessionScrollSyncTimerRef,
  setSessionScrollTop,
  messageListRef,
  setPendingMessageAreaFocus,
  setPendingMessagePageNavigation,
  setHistorySelection,
  sessionListRef,
  selectedSessionId,
  sessionPaneNavigationItems,
  sortedProjects,
  projectListRef,
  canNavigatePages,
  totalPages,
  canGoToNextHistoryPage,
  canGoToPreviousHistoryPage,
  visibleFocusedMessageId,
  sessionPage,
  selectedSession,
  selectedProject,
  sessionDetailTotalCount,
  allSessionsCount,
  sessionSearchInputRef,
  loadProjects,
  loadSessions,
  setProjectProviders,
  setProjectQueryInput,
  prettyProvider,
  refreshContextRef,
}: {
  codetrail: {
    invoke: (
      channel: "bookmarks:toggle",
      payload: {
        projectId: string;
        sessionId: string;
        messageId: string;
        messageSourceId: string;
      },
    ) => Promise<unknown>;
  };
  logError: (context: string, error: unknown) => void;
  scopedMessages: HistoryMessage[];
  areScopedMessagesExpanded: boolean;
  setMessageExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setSessionPage: Dispatch<SetStateAction<number>>;
  isExpandedByDefault: (category: MessageCategory) => boolean;
  historyMode: HistorySelection["mode"];
  bookmarksResponse: {
    results: Array<{
      projectId: string;
      sessionId: string;
      message: HistoryMessage;
    }>;
  };
  activeHistoryMessages: HistoryMessage[];
  selectedProjectId: string;
  historyCategories: MessageCategory[];
  setPendingSearchNavigation: Dispatch<SetStateAction<HistorySearchNavigation | null>>;
  setSessionQueryInput: Dispatch<SetStateAction<string>>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
  setPendingRevealTarget: Dispatch<SetStateAction<PendingRevealTarget | null>>;
  loadBookmarks: () => Promise<void>;
  sessionScrollTopRef: MutableRefObject<number>;
  sessionScrollSyncTimerRef: MutableRefObject<number | null>;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  messageListRef: RefObject<HTMLDivElement | null>;
  setPendingMessageAreaFocus: Dispatch<SetStateAction<boolean>>;
  setPendingMessagePageNavigation: Dispatch<SetStateAction<PendingMessagePageNavigation | null>>;
  setHistorySelection: Dispatch<SetStateAction<HistorySelection>>;
  sessionListRef: RefObject<HTMLDivElement | null>;
  selectedSessionId: string;
  sessionPaneNavigationItems: SessionPaneNavigationItem[];
  sortedProjects: ProjectSummary[];
  projectListRef: RefObject<HTMLDivElement | null>;
  canNavigatePages: boolean;
  totalPages: number;
  canGoToNextHistoryPage: boolean;
  canGoToPreviousHistoryPage: boolean;
  visibleFocusedMessageId: string;
  sessionPage: number;
  selectedSession: SessionSummary | null;
  selectedProject: ProjectSummary | null;
  sessionDetailTotalCount: number | null | undefined;
  allSessionsCount: number;
  sessionSearchInputRef: RefObject<HTMLInputElement | null>;
  loadProjects: () => Promise<void>;
  loadSessions: () => Promise<void>;
  setProjectProviders: Dispatch<SetStateAction<("claude" | "codex" | "gemini" | "cursor" | "copilot")[]>>;
  setProjectQueryInput: Dispatch<SetStateAction<string>>;
  prettyProvider: (provider: ProjectSummary["provider"]) => string;
  refreshContextRef: MutableRefObject<RefreshContext | null>;
}) {
  const handleToggleScopedMessagesExpanded = useCallback(() => {
    if (scopedMessages.length === 0) {
      return;
    }
    const expanded = !areScopedMessagesExpanded;
    setMessageExpanded((value) => {
      const next = { ...value };
      for (const message of scopedMessages) {
        next[message.id] = expanded;
      }
      return next;
    });
  }, [areScopedMessagesExpanded, scopedMessages, setMessageExpanded]);

  const handleToggleHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      setHistoryCategories((value) => toggleValue<MessageCategory>(value, category));
      setSessionPage(0);
    },
    [setHistoryCategories, setSessionPage],
  );

  const handleToggleCategoryMessagesExpanded = useCallback(
    (category: MessageCategory) => {
      const categoryMessages = activeHistoryMessages.filter(
        (message) => message.category === category,
      );
      if (categoryMessages.length === 0) {
        return;
      }
      setMessageExpanded((value) => {
        const expanded = !categoryMessages.every(
          (message) => value[message.id] ?? isExpandedByDefault(message.category),
        );
        const next = { ...value };
        for (const message of categoryMessages) {
          next[message.id] = expanded;
        }
        return next;
      });
    },
    [activeHistoryMessages, isExpandedByDefault, setMessageExpanded],
  );

  const handleToggleMessageExpanded = useCallback(
    (messageId: string, category: MessageCategory) => {
      setMessageExpanded((value) => ({
        ...value,
        [messageId]: !(value[messageId] ?? isExpandedByDefault(category)),
      }));
    },
    [isExpandedByDefault, setMessageExpanded],
  );

  const handleRevealInSession = useCallback(
    (messageId: string, sourceId: string) => {
      // Bookmarks/project-wide views route through pending search navigation because the controller
      // may need to switch projects or sessions before the message can be focused.
      if (historyMode === "bookmarks") {
        const bookmarked = bookmarksResponse.results.find(
          (entry) => entry.message.id === messageId,
        );
        if (!bookmarked) {
          return;
        }
        setPendingSearchNavigation({
          projectId: bookmarked.projectId,
          sessionId: bookmarked.sessionId,
          messageId,
          sourceId,
          historyCategories: [...historyCategories],
        });
        return;
      }

      if (historyMode === "project_all") {
        const projectMessage = activeHistoryMessages.find((entry) => entry.id === messageId);
        if (!projectMessage || !selectedProjectId) {
          return;
        }
        setPendingSearchNavigation({
          projectId: selectedProjectId,
          sessionId: projectMessage.sessionId,
          messageId,
          sourceId,
          historyCategories: [...historyCategories],
        });
        return;
      }

      setSessionQueryInput("");
      setFocusMessageId(messageId);
      setPendingRevealTarget({ messageId, sourceId });
    },
    [
      activeHistoryMessages,
      bookmarksResponse.results,
      historyCategories,
      historyMode,
      selectedProjectId,
      setFocusMessageId,
      setPendingRevealTarget,
      setPendingSearchNavigation,
      setSessionQueryInput,
    ],
  );

  const handleToggleBookmark = useCallback(
    async (message: HistoryMessage) => {
      if (!selectedProjectId) {
        return;
      }
      try {
        await codetrail.invoke("bookmarks:toggle", {
          projectId: selectedProjectId,
          sessionId: message.sessionId,
          messageId: message.id,
          messageSourceId: message.sourceId,
        });
        await loadBookmarks();
      } catch (error) {
        logError("Failed toggling bookmark", error);
      }
    },
    [codetrail, loadBookmarks, logError, selectedProjectId],
  );

  const handleMessageListScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      sessionScrollTopRef.current = Math.max(0, Math.round(event.currentTarget.scrollTop));
      if (sessionScrollSyncTimerRef.current !== null) {
        return;
      }
      // Debounce writes back into pane state so large scroll gestures do not spam persistence.
      sessionScrollSyncTimerRef.current = window.setTimeout(() => {
        sessionScrollSyncTimerRef.current = null;
        setSessionScrollTop((value) =>
          value === sessionScrollTopRef.current ? value : sessionScrollTopRef.current,
        );
      }, 120);
    },
    [sessionScrollSyncTimerRef, sessionScrollTopRef, setSessionScrollTop],
  );

  const handleHistorySearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      const focusTarget =
        messageListRef.current?.querySelector<HTMLElement>(
          ".message.focused .message-toggle-button",
        ) ??
        messageListRef.current?.querySelector<HTMLElement>(".message .message-toggle-button") ??
        messageListRef.current?.querySelector<HTMLElement>(".message .message-header");
      focusTarget?.focus();
    },
    [messageListRef],
  );

  const resetHistorySelectionState = useCallback(() => {
    // Changing history scope should clear any transient focus/navigation state carried over from a
    // previous scope.
    refreshContextRef.current = null;
    setPendingSearchNavigation(null);
    setPendingMessageAreaFocus(false);
    setPendingMessagePageNavigation(null);
    setSessionPage(0);
    setFocusMessageId("");
    setPendingRevealTarget(null);
  }, [
    refreshContextRef,
    setFocusMessageId,
    setPendingMessageAreaFocus,
    setPendingMessagePageNavigation,
    setPendingRevealTarget,
    setPendingSearchNavigation,
    setSessionPage,
  ]);

  const selectProjectAllMessages = useCallback(
    (projectId: string) => {
      resetHistorySelectionState();
      setHistorySelection(createHistorySelection("project_all", projectId, ""));
    },
    [resetHistorySelectionState, setHistorySelection],
  );

  const selectBookmarksView = useCallback(() => {
    resetHistorySelectionState();
    setHistorySelection(createHistorySelection("bookmarks", selectedProjectId, ""));
  }, [resetHistorySelectionState, selectedProjectId, setHistorySelection]);

  const selectSessionView = useCallback(
    (sessionId: string) => {
      resetHistorySelectionState();
      setHistorySelection(createHistorySelection("session", selectedProjectId, sessionId));
    },
    [resetHistorySelectionState, selectedProjectId, setHistorySelection],
  );

  const selectAdjacentSession = useCallback(
    (direction: Direction) => {
      const currentNavigationId =
        historyMode === "project_all"
          ? PROJECT_ALL_NAV_ID
          : historyMode === "bookmarks"
            ? BOOKMARKS_NAV_ID
            : selectedSessionId;
      const nextNavigationId = getAdjacentItemId(
        sessionPaneNavigationItems,
        currentNavigationId,
        direction,
      );
      if (!nextNavigationId) {
        return;
      }
      focusHistoryList(sessionListRef.current);
      if (nextNavigationId === PROJECT_ALL_NAV_ID) {
        selectProjectAllMessages(selectedProjectId);
        return;
      }
      if (nextNavigationId === BOOKMARKS_NAV_ID) {
        selectBookmarksView();
        return;
      }
      selectSessionView(nextNavigationId);
    },
    [
      historyMode,
      selectedProjectId,
      selectedSessionId,
      selectBookmarksView,
      selectProjectAllMessages,
      selectSessionView,
      sessionListRef,
      sessionPaneNavigationItems,
    ],
  );

  const selectAdjacentProject = useCallback(
    (direction: Direction) => {
      const nextProjectId = getAdjacentItemId(sortedProjects, selectedProjectId, direction);
      if (!nextProjectId) {
        return;
      }
      focusHistoryList(projectListRef.current);
      selectProjectAllMessages(nextProjectId);
    },
    [projectListRef, selectProjectAllMessages, selectedProjectId, sortedProjects],
  );

  const goToPreviousHistoryPage = useCallback(() => {
    if (!canNavigatePages) {
      return;
    }
    refreshContextRef.current = null;
    setSessionPage((value) => Math.max(0, value - 1));
  }, [canNavigatePages, refreshContextRef, setSessionPage]);

  const goToNextHistoryPage = useCallback(() => {
    if (!canNavigatePages) {
      return;
    }
    refreshContextRef.current = null;
    setSessionPage((value) => Math.min(totalPages - 1, value + 1));
  }, [canNavigatePages, refreshContextRef, setSessionPage, totalPages]);

  const focusAdjacentHistoryMessage = useCallback(
    (direction: Direction) => {
      if (activeHistoryMessages.length === 0) {
        return;
      }

      if (!visibleFocusedMessageId) {
        const firstVisibleMessageId = getFirstVisibleMessageId(messageListRef.current);
        if (firstVisibleMessageId) {
          setPendingMessageAreaFocus(true);
          setFocusMessageId(firstVisibleMessageId);
        }
        return;
      }

      const adjacentMessageId = getAdjacentItemId(
        activeHistoryMessages,
        visibleFocusedMessageId,
        direction,
      );
      if (adjacentMessageId) {
        setPendingMessageAreaFocus(true);
        setFocusMessageId(adjacentMessageId);
        return;
      }

      const canAdvancePage =
        direction === "next" ? canGoToNextHistoryPage : canGoToPreviousHistoryPage;
      if (!canAdvancePage) {
        return;
      }

      const targetPage =
        direction === "next"
          ? Math.min(totalPages - 1, sessionPage + 1)
          : Math.max(0, sessionPage - 1);
      // Crossing a page boundary is deferred until the new page loads, then the controller picks
      // the first/last visible message on that page.
      refreshContextRef.current = null;
      setPendingMessageAreaFocus(true);
      setPendingMessagePageNavigation({ direction, targetPage });
      setSessionPage(targetPage);
    },
    [
      activeHistoryMessages,
      canGoToNextHistoryPage,
      canGoToPreviousHistoryPage,
      messageListRef,
      refreshContextRef,
      sessionPage,
      setFocusMessageId,
      setPendingMessageAreaFocus,
      setPendingMessagePageNavigation,
      setSessionPage,
      totalPages,
      visibleFocusedMessageId,
    ],
  );

  const handleCopySessionDetails = useCallback(async () => {
    if (!selectedSession) {
      return;
    }
    const messageCount = sessionDetailTotalCount ?? selectedSession.messageCount;
    const pageCount = Math.max(1, Math.ceil(messageCount / PAGE_SIZE));
    const lines = [
      `Title: ${deriveSessionTitle(selectedSession)}`,
      `Provider: ${prettyProvider(selectedSession.provider)}`,
      `Project: ${selectedProject?.name || selectedProject?.path || "(unknown project)"}`,
      `Session ID: ${selectedSession.id}`,
      `File: ${selectedSession.filePath}`,
      `CWD: ${selectedSession.cwd ?? "-"}`,
      `Branch: ${selectedSession.gitBranch ?? "-"}`,
      `Models: ${selectedSession.modelNames || "-"}`,
      `Started: ${selectedSession.startedAt ?? "-"}`,
      `Ended: ${selectedSession.endedAt ?? "-"}`,
      `Duration: ${formatDuration(selectedSession.durationMs)}`,
      `Messages: ${messageCount}`,
      `Page: ${sessionPage + 1}/${pageCount}`,
    ];
    const copied = await copyTextToClipboard(lines.join("\n"));
    if (!copied) {
      logError("Failed copying session details", "Clipboard API unavailable");
    }
  }, [
    logError,
    prettyProvider,
    selectedProject,
    selectedSession,
    sessionDetailTotalCount,
    sessionPage,
  ]);

  const handleCopyProjectDetails = useCallback(async () => {
    if (!selectedProject) {
      return;
    }
    const lines = [
      `Name: ${selectedProject.name || "(untitled project)"}`,
      `Provider: ${prettyProvider(selectedProject.provider)}`,
      `Project ID: ${selectedProject.id}`,
      `Path: ${selectedProject.path || "-"}`,
      `Sessions: ${selectedProject.sessionCount}`,
      `Messages: ${allSessionsCount}`,
      `Last Activity: ${selectedProject.lastActivity ?? "-"}`,
    ];
    const copied = await copyTextToClipboard(lines.join("\n"));
    if (!copied) {
      logError("Failed copying project details", "Clipboard API unavailable");
    }
  }, [allSessionsCount, logError, prettyProvider, selectedProject]);

  const focusSessionSearch = useCallback(() => {
    window.setTimeout(() => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    }, 0);
  }, [sessionSearchInputRef]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([loadProjects(), loadSessions(), loadBookmarks()]);
  }, [loadBookmarks, loadProjects, loadSessions]);

  const navigateFromSearchResult = useCallback(
    (navigation: HistorySearchNavigation) => {
      setProjectProviders((value) => (value.length === PROVIDERS.length ? value : [...PROVIDERS]));
      setProjectQueryInput("");
      setPendingSearchNavigation(navigation);
      setHistorySelection((selectionState) =>
        setHistorySelectionProjectId(selectionState, navigation.projectId),
      );
    },
    [setHistorySelection, setPendingSearchNavigation, setProjectProviders, setProjectQueryInput],
  );

  return {
    handleToggleScopedMessagesExpanded,
    handleToggleHistoryCategoryShortcut,
    handleToggleCategoryMessagesExpanded,
    handleToggleMessageExpanded,
    handleRevealInSession,
    handleToggleBookmark,
    handleMessageListScroll,
    handleHistorySearchKeyDown,
    selectProjectAllMessages,
    selectBookmarksView,
    selectSessionView,
    selectAdjacentSession,
    selectAdjacentProject,
    goToPreviousHistoryPage,
    goToNextHistoryPage,
    focusAdjacentHistoryMessage,
    handleCopySessionDetails,
    handleCopyProjectDetails,
    focusSessionSearch,
    handleRefresh,
    navigateFromSearchResult,
  };
}
