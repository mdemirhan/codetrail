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

import type { MessageCategory, Provider } from "@codetrail/core/browser";

import { BOOKMARKS_NAV_ID, PAGE_SIZE, PROJECT_ALL_NAV_ID, PROVIDERS } from "../app/constants";
import { createHistorySelection, setHistorySelectionProjectId } from "../app/historySelection";
import type {
  HistoryMessage,
  HistorySearchNavigation,
  HistorySelection,
  HistorySelectionCommitMode,
  PendingMessagePageNavigation,
  PendingRevealTarget,
  ProjectSummary,
  SessionPaneNavigationItem,
  SessionSummary,
} from "../app/types";
import { copyTextToClipboard } from "../lib/clipboard";
import type { CodetrailClient } from "../lib/codetrailClient";
import {
  type Direction,
  getAdjacentItemId,
  getAdjacentVisibleProjectTarget,
  getFirstVisibleMessageId,
  getProjectNavigationTargetFromContainer,
  getProjectNavigationTargetFromElement,
  getProjectParentFolderTarget,
} from "../lib/historyNavigation";
import { toggleValue } from "../lib/viewUtils";
import { focusHistoryList } from "./historyControllerShared";
import { formatProjectDetails, formatSessionDetails } from "./historyCopyFormat";

function focusVisibleProjectTarget(
  projectListElement: HTMLDivElement | null,
  element: HTMLElement | null,
) {
  if (!projectListElement || !element) {
    return;
  }
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "nearest" });
}

type HistorySelectionOptions = {
  commitMode?: HistorySelectionCommitMode;
  waitForKeyboardIdle?: boolean;
};

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
  selection,
  bookmarkReturnSelection,
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
  setBookmarkReturnSelection,
  sessionListRef,
  selectedSessionId,
  sessionPaneNavigationItems,
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
  refreshContextRef,
  refreshTreeProjectSessions,
  pendingProjectPaneFocusCommitModeRef,
  pendingProjectPaneFocusWaitForKeyboardIdleRef,
}: {
  codetrail: CodetrailClient;
  logError: (context: string, error: unknown) => void;
  scopedMessages: HistoryMessage[];
  areScopedMessagesExpanded: boolean;
  setMessageExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setSessionPage: Dispatch<SetStateAction<number>>;
  isExpandedByDefault: (category: MessageCategory) => boolean;
  historyMode: HistorySelection["mode"];
  selection: HistorySelection;
  bookmarkReturnSelection: HistorySelection | null;
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
  setHistorySelection: (
    value: SetStateAction<HistorySelection>,
    options?: HistorySelectionOptions,
  ) => void;
  setBookmarkReturnSelection: Dispatch<SetStateAction<HistorySelection | null>>;
  sessionListRef: RefObject<HTMLDivElement | null>;
  selectedSessionId: string;
  sessionPaneNavigationItems: SessionPaneNavigationItem[];
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
  loadProjects: (source?: "auto" | "resort") => Promise<void>;
  loadSessions: () => Promise<void>;
  setProjectProviders: Dispatch<SetStateAction<Provider[]>>;
  setProjectQueryInput: Dispatch<SetStateAction<string>>;
  refreshContextRef: MutableRefObject<RefreshContext | null>;
  refreshTreeProjectSessions: () => Promise<void>;
  pendingProjectPaneFocusCommitModeRef: MutableRefObject<HistorySelectionCommitMode>;
  pendingProjectPaneFocusWaitForKeyboardIdleRef: MutableRefObject<boolean>;
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
      if (event.key === "Enter") {
        event.preventDefault();
        messageListRef.current?.focus({ preventScroll: true });
        return;
      }
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

  const focusProjectTargetWithCommitMode = useCallback(
    (target: ReturnType<typeof getAdjacentVisibleProjectTarget>) => {
      if (!target) {
        return;
      }
      pendingProjectPaneFocusCommitModeRef.current =
        target.kind === "session" ? "debounced_session" : "debounced_project";
      pendingProjectPaneFocusWaitForKeyboardIdleRef.current = true;
      focusVisibleProjectTarget(projectListRef.current, target.element);
    },
    [
      pendingProjectPaneFocusCommitModeRef,
      pendingProjectPaneFocusWaitForKeyboardIdleRef,
      projectListRef,
    ],
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

  const clearBookmarkReturnSelection = useCallback(() => {
    setBookmarkReturnSelection(null);
  }, [setBookmarkReturnSelection]);

  const selectProjectAllMessages = useCallback(
    (
      projectId: string,
      { commitMode = "immediate", waitForKeyboardIdle = false }: HistorySelectionOptions = {},
    ) => {
      resetHistorySelectionState();
      clearBookmarkReturnSelection();
      setHistorySelection(createHistorySelection("project_all", projectId, ""), {
        commitMode,
        waitForKeyboardIdle,
      });
    },
    [clearBookmarkReturnSelection, resetHistorySelectionState, setHistorySelection],
  );

  const selectBookmarksView = useCallback(
    ({ commitMode = "immediate", waitForKeyboardIdle = false }: HistorySelectionOptions = {}) => {
      resetHistorySelectionState();
      setBookmarkReturnSelection((current) => (historyMode === "bookmarks" ? current : selection));
      setHistorySelection(createHistorySelection("bookmarks", selectedProjectId, ""), {
        commitMode,
        waitForKeyboardIdle,
      });
    },
    [
      historyMode,
      resetHistorySelectionState,
      selectedProjectId,
      selection,
      setBookmarkReturnSelection,
      setHistorySelection,
    ],
  );

  const openProjectBookmarksView = useCallback(
    (
      projectId: string,
      { commitMode = "immediate", waitForKeyboardIdle = false }: HistorySelectionOptions = {},
    ) => {
      if (!projectId) {
        return;
      }
      if (historyMode === "bookmarks" && selectedProjectId === projectId) {
        resetHistorySelectionState();
        const nextSelection =
          bookmarkReturnSelection ?? createHistorySelection("project_all", projectId, "");
        setBookmarkReturnSelection(null);
        setHistorySelection(nextSelection, { commitMode, waitForKeyboardIdle });
        return;
      }
      resetHistorySelectionState();
      setBookmarkReturnSelection((current) => (historyMode === "bookmarks" ? current : selection));
      setHistorySelection(createHistorySelection("bookmarks", projectId, ""), {
        commitMode,
        waitForKeyboardIdle,
      });
    },
    [
      bookmarkReturnSelection,
      historyMode,
      resetHistorySelectionState,
      selectedProjectId,
      selection,
      setBookmarkReturnSelection,
      setHistorySelection,
    ],
  );

  const closeBookmarksView = useCallback(() => {
    resetHistorySelectionState();
    const nextSelection =
      bookmarkReturnSelection ?? createHistorySelection("project_all", selectedProjectId, "");
    setBookmarkReturnSelection(null);
    setHistorySelection(nextSelection, { commitMode: "immediate" });
  }, [
    bookmarkReturnSelection,
    resetHistorySelectionState,
    selectedProjectId,
    setBookmarkReturnSelection,
    setHistorySelection,
  ]);

  const selectSessionView = useCallback(
    (
      sessionId: string,
      projectId = selectedProjectId,
      { commitMode = "immediate", waitForKeyboardIdle = false }: HistorySelectionOptions = {},
    ) => {
      resetHistorySelectionState();
      clearBookmarkReturnSelection();
      setHistorySelection(createHistorySelection("session", projectId, sessionId), {
        commitMode,
        waitForKeyboardIdle,
      });
    },
    [
      clearBookmarkReturnSelection,
      resetHistorySelectionState,
      selectedProjectId,
      setHistorySelection,
    ],
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
        selectProjectAllMessages(selectedProjectId, {
          commitMode: "debounced_session",
          waitForKeyboardIdle: true,
        });
        return;
      }
      if (nextNavigationId === BOOKMARKS_NAV_ID) {
        selectBookmarksView({ commitMode: "debounced_session", waitForKeyboardIdle: true });
        return;
      }
      selectSessionView(nextNavigationId, selectedProjectId, {
        commitMode: "debounced_session",
        waitForKeyboardIdle: true,
      });
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
      const currentTarget =
        getProjectNavigationTargetFromElement(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        ) ?? getProjectNavigationTargetFromContainer(projectListRef.current);
      const visibleTarget = getAdjacentVisibleProjectTarget(
        projectListRef.current,
        currentTarget,
        direction,
      );
      if (!visibleTarget) {
        return;
      }

      focusProjectTargetWithCommitMode(visibleTarget);
    },
    [focusProjectTargetWithCommitMode, projectListRef],
  );

  const handleProjectTreeArrow = useCallback(
    (direction: "left" | "right") => {
      const container = projectListRef.current;
      if (!container) {
        return;
      }
      const currentTarget =
        getProjectNavigationTargetFromElement(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        ) ?? getProjectNavigationTargetFromContainer(container);
      if (!currentTarget) {
        return;
      }

      if (currentTarget.kind === "folder") {
        const folderElement = container.querySelector<HTMLButtonElement>(
          `[data-project-nav-kind="folder"][data-folder-id="${CSS.escape(currentTarget.id)}"]`,
        );
        if (!folderElement) {
          return;
        }
        const folderToggleElement = container.querySelector<HTMLElement>(
          `[data-project-expand-toggle-for="${CSS.escape(currentTarget.id)}"]`,
        );
        const expanded = folderElement.getAttribute("aria-expanded") === "true";
        if (direction === "right" && !expanded) {
          folderToggleElement?.click();
          focusVisibleProjectTarget(container, folderElement);
          return;
        }
        if (direction === "left" && expanded) {
          folderToggleElement?.click();
          focusVisibleProjectTarget(container, folderElement);
          return;
        }
        if (direction === "right" && expanded) {
          const childTarget = getAdjacentVisibleProjectTarget(container, currentTarget, "next");
          if (childTarget) {
            focusProjectTargetWithCommitMode(childTarget);
          }
        }
        return;
      }

      if (currentTarget.kind === "session") {
        if (direction === "left") {
          const projectElement = container.querySelector<HTMLButtonElement>(
            `[data-project-nav-kind="project"][data-project-nav-id="${CSS.escape(currentTarget.projectId)}"]`,
          );
          if (!projectElement) {
            return;
          }
          pendingProjectPaneFocusCommitModeRef.current = "debounced_project";
          pendingProjectPaneFocusWaitForKeyboardIdleRef.current = true;
          focusVisibleProjectTarget(container, projectElement);
        }
        return;
      }

      const projectElement = container.querySelector<HTMLElement>(
        `[data-project-nav-kind="project"][data-project-nav-id="${CSS.escape(currentTarget.id)}"]`,
      );
      const expanded = projectElement?.getAttribute("aria-expanded") === "true";
      const canExpand = projectElement?.dataset.projectCanExpand === "true";
      const toggle = container.querySelector<HTMLElement>(
        `[data-project-expand-toggle-for="${CSS.escape(currentTarget.id)}"]`,
      );

      if (direction === "right" && canExpand && !expanded) {
        toggle?.click();
        focusVisibleProjectTarget(container, projectElement);
        return;
      }
      if (direction === "left" && canExpand && expanded) {
        toggle?.click();
        focusVisibleProjectTarget(container, projectElement);
        return;
      }
      if (direction === "right" && expanded) {
        const childTarget = getAdjacentVisibleProjectTarget(container, currentTarget, "next");
        if (!childTarget) {
          return;
        }
        focusProjectTargetWithCommitMode(childTarget);
        return;
      }
      if (direction === "left") {
        const parentFolder = getProjectParentFolderTarget(container, currentTarget.id);
        if (!parentFolder || parentFolder.kind !== "folder") {
          return;
        }
        focusProjectTargetWithCommitMode(parentFolder);
      }
    },
    [
      focusProjectTargetWithCommitMode,
      pendingProjectPaneFocusCommitModeRef,
      pendingProjectPaneFocusWaitForKeyboardIdleRef,
      projectListRef,
    ],
  );

  const handleProjectTreeEnter = useCallback(() => {
    const container = projectListRef.current;
    if (!container) {
      return;
    }
    const currentTarget =
      getProjectNavigationTargetFromElement(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      ) ?? getProjectNavigationTargetFromContainer(container);
    if (!currentTarget) {
      return;
    }

    if (currentTarget.kind === "folder") {
      const folderElement = container.querySelector<HTMLButtonElement>(
        `[data-project-nav-kind="folder"][data-folder-id="${CSS.escape(currentTarget.id)}"]`,
      );
      folderElement?.click();
      return;
    }

    if (currentTarget.kind === "project") {
      const projectElement = container.querySelector<HTMLElement>(
        `[data-project-nav-kind="project"][data-project-nav-id="${CSS.escape(currentTarget.id)}"]`,
      );
      const canExpand = projectElement?.dataset.projectCanExpand === "true";
      if (!canExpand) {
        return;
      }
      const toggle = container.querySelector<HTMLElement>(
        `[data-project-expand-toggle-for="${CSS.escape(currentTarget.id)}"]`,
      );
      toggle?.click();
    }
  }, [projectListRef]);

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
        setPendingMessageAreaFocus(true);
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
    const copied = await copyTextToClipboard(
      formatSessionDetails(selectedSession, {
        projectLabel: selectedProject?.name || selectedProject?.path || "(unknown project)",
        messageCount,
        page: { current: sessionPage + 1, total: pageCount },
      }),
    );
    if (!copied) {
      logError("Failed copying session details", "Clipboard API unavailable");
    }
  }, [logError, selectedProject, selectedSession, sessionDetailTotalCount, sessionPage]);

  const handleCopyProjectDetails = useCallback(async () => {
    if (!selectedProject) {
      return;
    }
    const copied = await copyTextToClipboard(
      formatProjectDetails(selectedProject, { messageCount: allSessionsCount }),
    );
    if (!copied) {
      logError("Failed copying project details", "Clipboard API unavailable");
    }
  }, [allSessionsCount, logError, selectedProject]);

  const focusSessionSearch = useCallback(() => {
    window.setTimeout(() => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    }, 0);
  }, [sessionSearchInputRef]);

  const handleRefresh = useCallback(
    async (source: "auto" | "manual" = "manual") => {
      await Promise.all([
        loadProjects(source === "auto" ? "auto" : "resort"),
        loadSessions(),
        loadBookmarks(),
        refreshTreeProjectSessions(),
      ]);
    },
    [loadBookmarks, loadProjects, loadSessions, refreshTreeProjectSessions],
  );

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
    openProjectBookmarksView,
    closeBookmarksView,
    selectSessionView,
    selectAdjacentSession,
    selectAdjacentProject,
    handleProjectTreeArrow,
    handleProjectTreeEnter,
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
