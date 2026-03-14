import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  UIEvent as ReactUIEvent,
  SetStateAction,
} from "react";

import type {
  MessageCategory,
  Provider,
  SearchMode,
  SystemMessageRegexRules,
} from "@codetrail/core";

import {
  BOOKMARKS_NAV_ID,
  DEFAULT_MESSAGE_CATEGORIES,
  EMPTY_BOOKMARKS_RESPONSE,
  EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  PAGE_SIZE,
  PROJECT_ALL_NAV_ID,
  PROVIDERS,
} from "../app/constants";
import {
  createHistorySelection,
  createHistorySelectionFromPaneState,
  setHistorySelectionProjectId,
  setHistorySelectionSessionId,
} from "../app/historySelection";
import type {
  BookmarkListResponse,
  BulkExpandScope,
  HistoryMessage,
  HistorySearchNavigation,
  HistorySelection,
  PaneStateSnapshot,
  PendingMessagePageNavigation,
  PendingRevealTarget,
  ProjectCombinedDetail,
  ProjectSummary,
  SessionDetail,
  SessionPaneNavigationItem,
  SessionSummary,
  SortDirection,
} from "../app/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePaneStateSync } from "../hooks/usePaneStateSync";
import { useResizablePanes } from "../hooks/useResizablePanes";
import { copyTextToClipboard } from "../lib/clipboard";
import { useCodetrailClient } from "../lib/codetrailClient";
import {
  type Direction,
  getAdjacentItemId,
  getEdgeItemId,
  getFirstVisibleMessageId,
} from "../lib/historyNavigation";
import {
  clamp,
  compareRecent,
  deriveSessionTitle,
  prettyProvider,
  sessionActivityOf,
  toggleValue,
} from "../lib/viewUtils";
import {
  type AppearanceState,
  focusHistoryList,
  formatDuration,
  scrollFocusedHistoryMessageIntoView,
} from "./historyControllerShared";
import { useHistoryDataEffects } from "./useHistoryDataEffects";
import { useHistoryDerivedState } from "./useHistoryDerivedState";
import { useHistoryInteractions } from "./useHistoryInteractions";

// useHistoryController is the stateful coordinator for the history UI. It owns selection, pane
// layout, persisted UI state, data loading hooks, and keyboard/navigation wiring.
export function useHistoryController({
  initialPaneState,
  isHistoryLayout,
  searchMode,
  searchProviders,
  setSearchProviders,
  appearance,
  logError,
  autoScrollEnabled = false,
  setAutoScrollEnabled,
  periodicRefreshInterval = 0,
  setPeriodicRefreshInterval,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  isHistoryLayout: boolean;
  searchMode: SearchMode;
  searchProviders: Provider[];
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  appearance: AppearanceState;
  logError: (context: string, error: unknown) => void;
  autoScrollEnabled?: boolean;
  setAutoScrollEnabled: Dispatch<SetStateAction<boolean>>;
  periodicRefreshInterval?: number;
  setPeriodicRefreshInterval: Dispatch<SetStateAction<number>>;
}) {
  const codetrail = useCodetrailClient();
  const initialProjectPaneWidth = clamp(initialPaneState?.projectPaneWidth ?? 300, 230, 520);
  const initialSessionPaneWidth = clamp(initialPaneState?.sessionPaneWidth ?? 320, 250, 620);
  const initialSessionScrollTop = initialPaneState?.sessionScrollTop ?? 0;

  const [projectQueryInput, setProjectQueryInput] = useState("");
  const [projectProviders, setProjectProviders] = useState<Provider[]>(
    initialPaneState?.projectProviders ?? [...PROVIDERS],
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selection, setHistorySelection] = useState<HistorySelection>(() =>
    createHistorySelectionFromPaneState(initialPaneState),
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoadedProjectId, setSessionsLoadedProjectId] = useState<string | null>(null);
  const [bookmarksLoadedProjectId, setBookmarksLoadedProjectId] = useState<string | null>(null);
  const [sessionPaneStableProjectId, setSessionPaneStableProjectId] = useState<string | null>(
    initialPaneState?.selectedProjectId ?? null,
  );
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [projectCombinedDetail, setProjectCombinedDetail] = useState<ProjectCombinedDetail | null>(
    null,
  );
  const [bookmarksResponse, setBookmarksResponse] =
    useState<BookmarkListResponse>(EMPTY_BOOKMARKS_RESPONSE);
  const [sessionPage, setSessionPage] = useState(initialPaneState?.sessionPage ?? 0);
  const [sessionScrollTop, setSessionScrollTop] = useState(initialSessionScrollTop);
  const [systemMessageRegexRules, setSystemMessageRegexRules] = useState<SystemMessageRegexRules>(
    initialPaneState?.systemMessageRegexRules ?? EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  );
  const [projectSortDirection, setProjectSortDirection] = useState<SortDirection>(
    initialPaneState?.projectSortDirection ?? "desc",
  );
  const [sessionSortDirection, setSessionSortDirection] = useState<SortDirection>(
    initialPaneState?.sessionSortDirection ?? "desc",
  );
  const [messageSortDirection, setMessageSortDirection] = useState<SortDirection>(
    initialPaneState?.messageSortDirection ?? "asc",
  );
  const [bookmarkSortDirection, setBookmarkSortDirection] = useState<SortDirection>(
    initialPaneState?.bookmarkSortDirection ?? "asc",
  );
  const [projectAllSortDirection, setProjectAllSortDirection] = useState<SortDirection>(
    initialPaneState?.projectAllSortDirection ?? "desc",
  );
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [bookmarkQueryInput, setBookmarkQueryInput] = useState("");
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>(
    initialPaneState?.historyCategories ?? [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const [expandedByDefaultCategories, setExpandedByDefaultCategories] = useState<MessageCategory[]>(
    initialPaneState?.expandedByDefaultCategories ?? [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const [projectPaneCollapsed, setProjectPaneCollapsed] = useState(
    initialPaneState?.projectPaneCollapsed ?? false,
  );
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = useState(
    initialPaneState?.sessionPaneCollapsed ?? false,
  );
  const [bulkExpandScope, setBulkExpandScope] = useState<BulkExpandScope>("all");
  const [messageExpanded, setMessageExpanded] = useState<Record<string, boolean>>({});
  const [focusMessageId, setFocusMessageId] = useState("");
  const [pendingRevealTarget, setPendingRevealTarget] = useState<PendingRevealTarget | null>(null);
  const [pendingMessageAreaFocus, setPendingMessageAreaFocus] = useState(false);
  const [pendingMessagePageNavigation, setPendingMessagePageNavigation] =
    useState<PendingMessagePageNavigation | null>(null);
  const [pendingSearchNavigation, setPendingSearchNavigation] =
    useState<HistorySearchNavigation | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const projectQuery = useDebouncedValue(projectQueryInput, 180);
  const sessionQuery = useDebouncedValue(sessionQueryInput, 400);
  const bookmarkQuery = useDebouncedValue(bookmarkQueryInput, 400);
  const effectiveSessionQuery = sessionQueryInput.trim().length === 0 ? "" : sessionQuery;
  const effectiveBookmarkQuery = bookmarkQueryInput.trim().length === 0 ? "" : bookmarkQuery;

  const focusedMessageRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const projectListRef = useRef<HTMLDivElement | null>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement | null>(null);
  // Persisted scroll restoration only applies to the same session/page snapshot that was saved.
  const pendingRestoredSessionScrollRef = useRef<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>(
    initialPaneState?.selectedSessionId &&
      typeof initialPaneState?.sessionPage === "number" &&
      typeof initialPaneState?.sessionScrollTop === "number" &&
      initialPaneState.sessionScrollTop > 0
      ? {
          sessionId: initialPaneState.selectedSessionId,
          sessionPage: initialPaneState.sessionPage,
          scrollTop: initialPaneState.sessionScrollTop,
        }
      : null,
  );
  const scrollPreservationRef = useRef<{
    scrollTop: number;
    referenceMessageId: string;
    referenceOffsetTop: number;
  } | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const prevMessageIdsRef = useRef("");

  const projectsLoadTokenRef = useRef(0);
  const sessionsLoadTokenRef = useRef(0);
  const bookmarksLoadTokenRef = useRef(0);
  const sessionScrollTopRef = useRef(initialSessionScrollTop);
  const sessionScrollSyncTimerRef = useRef<number | null>(null);

  const {
    projectPaneWidth,
    setProjectPaneWidth,
    sessionPaneWidth,
    setSessionPaneWidth,
    beginResize,
  } = useResizablePanes({
    isHistoryLayout,
    projectMin: 230,
    projectMax: 520,
    sessionMin: 250,
    sessionMax: 620,
    initialProjectPaneWidth,
    initialSessionPaneWidth,
  });

  const rawSelectedProjectId = selection.projectId;
  const rawSelectedSessionId = selection.mode === "session" ? selection.sessionId : "";
  const historyMode = selection.mode;

  const sortedProjects = useMemo(() => {
    const next = [...projects];
    next.sort((left, right) => {
      const byRecent =
        compareRecent(right.lastActivity, left.lastActivity) || left.name.localeCompare(right.name);
      return projectSortDirection === "desc" ? byRecent : -byRecent;
    });
    return next;
  }, [projectSortDirection, projects]);

  const sortedSessions = useMemo(() => {
    const next = [...sessions];
    next.sort((left, right) => {
      const byRecent =
        compareRecent(sessionActivityOf(right), sessionActivityOf(left)) ||
        right.messageCount - left.messageCount;
      return sessionSortDirection === "desc" ? byRecent : -byRecent;
    });
    return next;
  }, [sessionSortDirection, sessions]);

  const selectedProjectId = rawSelectedProjectId || sortedProjects[0]?.id || "";
  const selectedSessionId = rawSelectedSessionId;

  const paneStateForSync = useMemo(
    () => ({
      // Keep the persisted snapshot derived from the controller's canonical selection state so
      // restoration does not drift from what the UI is actually rendering.
      projectPaneWidth,
      sessionPaneWidth,
      projectPaneCollapsed,
      sessionPaneCollapsed,
      projectProviders,
      historyCategories,
      expandedByDefaultCategories,
      searchProviders,
      theme: appearance.theme,
      monoFontFamily: appearance.monoFontFamily,
      regularFontFamily: appearance.regularFontFamily,
      monoFontSize: appearance.monoFontSize,
      regularFontSize: appearance.regularFontSize,
      useMonospaceForAllMessages: appearance.useMonospaceForAllMessages,
      selectedProjectId,
      selectedSessionId,
      historyMode,
      projectSortDirection,
      sessionSortDirection,
      messageSortDirection,
      bookmarkSortDirection,
      projectAllSortDirection,
      sessionPage,
      sessionScrollTop,
      systemMessageRegexRules,
      autoScrollEnabled,
      periodicRefreshInterval,
    }),
    [
      appearance.monoFontFamily,
      appearance.monoFontSize,
      appearance.regularFontFamily,
      appearance.regularFontSize,
      appearance.theme,
      appearance.useMonospaceForAllMessages,
      bookmarkSortDirection,
      expandedByDefaultCategories,
      historyCategories,
      historyMode,
      messageSortDirection,
      projectAllSortDirection,
      projectPaneCollapsed,
      projectPaneWidth,
      projectProviders,
      projectSortDirection,
      searchProviders,
      selectedProjectId,
      selectedSessionId,
      sessionPage,
      sessionPaneCollapsed,
      sessionPaneWidth,
      sessionScrollTop,
      autoScrollEnabled,
      periodicRefreshInterval,
      sessionSortDirection,
      systemMessageRegexRules,
    ],
  );

  const setSelectedProjectIdForPaneStateSync = useCallback((value: SetStateAction<string>) => {
    setHistorySelection((selectionState) =>
      typeof value === "function"
        ? setHistorySelectionProjectId(selectionState, value(selectionState.projectId))
        : setHistorySelectionProjectId(selectionState, value),
    );
  }, []);

  const setSelectedSessionIdForPaneStateSync = useCallback((value: SetStateAction<string>) => {
    setHistorySelection((selectionState) =>
      typeof value === "function"
        ? setHistorySelectionSessionId(
            selectionState,
            value(selectionState.mode === "session" ? selectionState.sessionId : ""),
          )
        : setHistorySelectionSessionId(selectionState, value),
    );
  }, []);

  const setHistoryModeForPaneStateSync = useCallback(
    (value: SetStateAction<HistorySelection["mode"]>) => {
      setHistorySelection((selectionState) =>
        createHistorySelection(
          typeof value === "function" ? value(selectionState.mode) : value,
          selectionState.projectId,
          selectionState.mode === "session" ? selectionState.sessionId : "",
        ),
      );
    },
    [],
  );

  const { paneStateHydrated } = usePaneStateSync({
    initialPaneStateHydrated: initialPaneState !== null,
    logError,
    paneState: paneStateForSync,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setTheme: appearance.setTheme,
    setMonoFontFamily: appearance.setMonoFontFamily,
    setRegularFontFamily: appearance.setRegularFontFamily,
    setMonoFontSize: appearance.setMonoFontSize,
    setRegularFontSize: appearance.setRegularFontSize,
    setUseMonospaceForAllMessages: appearance.setUseMonospaceForAllMessages,
    setHistorySelection,
    setSelectedProjectId: setSelectedProjectIdForPaneStateSync,
    setSelectedSessionId: setSelectedSessionIdForPaneStateSync,
    setHistoryMode: setHistoryModeForPaneStateSync,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    setAutoScrollEnabled,
    setPeriodicRefreshInterval,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

  const { loadProjects, loadSessions, loadBookmarks } = useHistoryDataEffects({
    codetrail,
    logError,
    projectProviders,
    projectQuery,
    rawSelectedProjectId,
    selectedProjectId,
    selectedSessionId,
    sortedProjects,
    sortedSessions,
    pendingSearchNavigation,
    setPendingSearchNavigation,
    setHistorySelection,
    setProjects,
    setProjectsLoaded,
    projectsLoaded,
    setSessions,
    setSessionsLoadedProjectId,
    setBookmarksResponse,
    setBookmarksLoadedProjectId,
    historyCategories,
    effectiveBookmarkQuery,
    effectiveSessionQuery,
    searchMode,
    paneStateHydrated,
    historyMode,
    setSessionPage,
    setSessionQueryInput,
    setHistoryCategories,
    setFocusMessageId,
    setPendingRevealTarget,
    pendingRevealTarget,
    messageSortDirection,
    projectAllSortDirection,
    sessionPage,
    setSessionDetail,
    setProjectCombinedDetail,
    bookmarksLoadedProjectId,
    bookmarksResponse,
    setSessionPaneStableProjectId,
    sessionsLoadedProjectId,
    projectsLoadTokenRef,
    sessionsLoadTokenRef,
    bookmarksLoadTokenRef,
    refreshCounter,
  });

  useEffect(() => {
    return () => {
      if (sessionScrollSyncTimerRef.current !== null) {
        window.clearTimeout(sessionScrollSyncTimerRef.current);
      }
    };
  }, []);

  const {
    activeMessageSortDirection,
    messageSortScopeLabel,
    messageSortTooltip,
    bookmarkOrphanedByMessageId,
    bookmarkedMessageIds,
    activeHistoryMessages,
    visibleFocusedMessageId,
    focusedMessagePosition,
    loadedHistoryPage,
    selectedProject,
    selectedSession,
    allSessionsCount,
    visibleSessionPaneSessions,
    visibleSessionPaneBookmarksCount,
    visibleSessionPaneAllSessionsCount,
    sessionPaneNavigationItems,
    messagePathRoots,
    projectProviderCounts,
    totalPages,
    canNavigatePages,
    canGoToPreviousHistoryPage,
    canGoToNextHistoryPage,
    historyCategoryCounts,
    historyQueryError,
    historyHighlightPatterns,
    isExpandedByDefault,
    scopedMessages,
    areScopedMessagesExpanded,
    scopedActionLabel,
    scopedExpandCollapseLabel,
    workspaceStyle,
    selectedSummaryProvider,
    selectedSummaryMessageCount,
    selectedTitle,
    selectedProviderLabel,
    historyCategoriesShortcutMap,
    prettyCategory,
    prettyProvider: formatPrettyProvider,
    formatDate,
  } = useHistoryDerivedState({
    historyMode,
    sortedProjects,
    sortedSessions,
    selectedProjectId,
    selectedSessionId,
    sessionPaneStableProjectId,
    bookmarksResponse,
    bookmarkSortDirection,
    projectCombinedDetail,
    sessionDetail,
    projectAllSortDirection,
    messageSortDirection,
    focusMessageId,
    sessionPage,
    expandedByDefaultCategories,
    bulkExpandScope,
    messageExpanded,
    isHistoryLayout,
    projectPaneCollapsed,
    projectPaneWidth,
    sessionPaneCollapsed,
    sessionPaneWidth,
  });

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }
    if (historyMode === "bookmarks") {
      messageListRef.current.scrollTop = 0;
      sessionScrollTopRef.current = 0;
      setSessionScrollTop(0);
      return;
    }
    const scrollScopeId = historyMode === "project_all" ? selectedProjectId : selectedSessionId;
    if (!scrollScopeId || sessionPage < 0) {
      messageListRef.current.scrollTop = 0;
      sessionScrollTopRef.current = 0;
      setSessionScrollTop(0);
      return;
    }

    const pendingRestore = pendingRestoredSessionScrollRef.current;
    if (
      pendingRestore &&
      pendingRestore.sessionId === scrollScopeId &&
      pendingRestore.sessionPage === sessionPage
    ) {
      // Restore once for the exact saved view, then fall back to normal top-of-list behavior on
      // any later navigation.
      messageListRef.current.scrollTop = pendingRestore.scrollTop;
      sessionScrollTopRef.current = pendingRestore.scrollTop;
      setSessionScrollTop(pendingRestore.scrollTop);
      pendingRestoredSessionScrollRef.current = null;
      return;
    }

    if (pendingRestore) {
      pendingRestoredSessionScrollRef.current = null;
    }
    messageListRef.current.scrollTop = 0;
    sessionScrollTopRef.current = 0;
    setSessionScrollTop(0);
  }, [historyMode, selectedProjectId, selectedSessionId, sessionPage]);

  useEffect(() => {
    if (
      !focusMessageId ||
      !visibleFocusedMessageId ||
      focusedMessagePosition < 0 ||
      !focusedMessageRef.current ||
      !messageListRef.current
    ) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      if (!focusedMessageRef.current || !messageListRef.current) {
        return;
      }
      scrollFocusedHistoryMessageIntoView(messageListRef.current, focusedMessageRef.current);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [focusMessageId, focusedMessagePosition, visibleFocusedMessageId]);

  useEffect(() => {
    if (!pendingMessageAreaFocus || !visibleFocusedMessageId || !messageListRef.current) {
      return;
    }

    messageListRef.current.focus({ preventScroll: true });
    setPendingMessageAreaFocus(false);
  }, [pendingMessageAreaFocus, visibleFocusedMessageId]);

  useEffect(() => {
    if (!pendingMessagePageNavigation) {
      return;
    }
    if (loadedHistoryPage !== pendingMessagePageNavigation.targetPage) {
      return;
    }

    const targetMessageId = getEdgeItemId(
      activeHistoryMessages,
      pendingMessagePageNavigation.direction,
    );
    setPendingMessagePageNavigation(null);
    if (!targetMessageId) {
      return;
    }
    setFocusMessageId(targetMessageId);
  }, [activeHistoryMessages, loadedHistoryPage, pendingMessagePageNavigation]);

  // Scroll preservation after refresh: restore the scroll position so the same messages stay
  // visible. Auto-scroll: scroll to the edge when new messages arrive during periodic refresh.
  useLayoutEffect(() => {
    const container = messageListRef.current;
    if (!container) return;

    if (pendingAutoScrollRef.current) {
      pendingAutoScrollRef.current = false;
      const currentIds = activeHistoryMessages.map((m) => m.id).join(",");
      if (currentIds !== prevMessageIdsRef.current) {
        prevMessageIdsRef.current = currentIds;
        // Use rAF to ensure the DOM has fully laid out before scrolling.
        window.requestAnimationFrame(() => {
          if (activeMessageSortDirection === "asc") {
            container.scrollTop = container.scrollHeight;
          } else {
            container.scrollTop = 0;
          }
        });
      }
      return;
    }

    const saved = scrollPreservationRef.current;
    if (!saved) return;
    scrollPreservationRef.current = null;

    if (saved.referenceMessageId) {
      const refEl = container.querySelector<HTMLElement>(
        `[data-history-message-id="${CSS.escape(saved.referenceMessageId)}"]`,
      );
      if (refEl) {
        const drift = refEl.offsetTop - saved.referenceOffsetTop;
        container.scrollTop = saved.scrollTop + drift;
        return;
      }
    }
    // Fallback: preserve raw scrollTop
    container.scrollTop = saved.scrollTop;
  }, [activeHistoryMessages, activeMessageSortDirection]);

  const {
    handleToggleScopedMessagesExpanded,
    handleToggleHistoryCategoryShortcut,
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
  } = useHistoryInteractions({
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
    sessionDetailTotalCount: sessionDetail?.totalCount,
    allSessionsCount,
    sessionSearchInputRef,
    loadProjects,
    loadSessions,
    setProjectProviders,
    setProjectQueryInput,
    prettyProvider: formatPrettyProvider,
  });

  return {
    refs: {
      focusedMessageRef,
      messageListRef,
      sessionListRef,
      projectListRef,
      sessionSearchInputRef,
    },
    selection,
    historyMode,
    selectedProjectId,
    selectedSessionId,
    paneStateHydrated,
    sortedProjects,
    sortedSessions,
    selectedProject,
    selectedSession,
    projectProviders,
    setProjectProviders,
    projectQueryInput,
    setProjectQueryInput,
    projectProviderCounts,
    projectSortDirection,
    setProjectSortDirection,
    sessionSortDirection,
    setSessionSortDirection,
    messageSortDirection,
    setMessageSortDirection,
    bookmarkSortDirection,
    setBookmarkSortDirection,
    projectAllSortDirection,
    setProjectAllSortDirection,
    historyCategories,
    setHistoryCategories,
    expandedByDefaultCategories,
    setExpandedByDefaultCategories,
    systemMessageRegexRules,
    setSystemMessageRegexRules,
    projectPaneCollapsed,
    setProjectPaneCollapsed,
    sessionPaneCollapsed,
    setSessionPaneCollapsed,
    beginResize,
    workspaceStyle,
    sessionPaneNavigationItems,
    visibleSessionPaneSessions,
    visibleSessionPaneBookmarksCount,
    visibleSessionPaneAllSessionsCount,
    allSessionsCount,
    sessionDetail,
    projectCombinedDetail,
    bookmarksResponse,
    activeHistoryMessages,
    historyCategoryCounts,
    historyQueryError,
    historyHighlightPatterns,
    bookmarkedMessageIds,
    bookmarkOrphanedByMessageId,
    focusMessageId,
    setFocusMessageId,
    visibleFocusedMessageId,
    sessionPage,
    setSessionPage,
    sessionQueryInput,
    setSessionQueryInput,
    bookmarkQueryInput,
    setBookmarkQueryInput,
    effectiveSessionQuery,
    effectiveBookmarkQuery,
    totalPages,
    canNavigatePages,
    canGoToPreviousHistoryPage,
    canGoToNextHistoryPage,
    activeMessageSortDirection,
    messageSortTooltip,
    messageSortScopeLabel,
    bulkExpandScope,
    setBulkExpandScope,
    scopedMessages,
    areScopedMessagesExpanded,
    scopedActionLabel,
    scopedExpandCollapseLabel,
    messageExpanded,
    messagePathRoots,
    isExpandedByDefault,
    handleToggleScopedMessagesExpanded,
    handleToggleHistoryCategoryShortcut,
    handleToggleMessageExpanded,
    handleToggleBookmark,
    handleRevealInSession,
    handleMessageListScroll,
    handleHistorySearchKeyDown,
    handleCopySessionDetails,
    handleCopyProjectDetails,
    focusSessionSearch,
    focusAdjacentHistoryMessage,
    selectAdjacentSession,
    selectAdjacentProject,
    selectProjectAllMessages,
    selectBookmarksView,
    selectSessionView,
    goToPreviousHistoryPage,
    goToNextHistoryPage,
    handleRefresh,
    navigateFromSearchResult,
    setPendingSearchNavigation,
    pendingSearchNavigation,
    selectedSummaryProvider,
    selectedSummaryMessageCount,
    selectedTitle,
    selectedProviderLabel,
    historyCategoriesShortcutMap,
    prettyCategory,
    prettyProvider: formatPrettyProvider,
    formatDate,
    handleRefreshAllData: useCallback(async () => {
      const container = messageListRef.current;
      if (autoScrollEnabled) {
        pendingAutoScrollRef.current = true;
        // Snapshot current message IDs from the DOM to detect new messages after refresh.
        const ids = container
          ? Array.from(
              container.querySelectorAll<HTMLElement>("[data-history-message-id]"),
              (el) => el.getAttribute("data-history-message-id"),
            ).join(",")
          : "";
        prevMessageIdsRef.current = ids;
      } else if (container) {
        const elements = Array.from(
          container.querySelectorAll<HTMLElement>("[data-history-message-id]"),
        );
        for (const el of elements) {
          if (el.offsetTop + el.offsetHeight > container.scrollTop) {
            scrollPreservationRef.current = {
              scrollTop: container.scrollTop,
              referenceMessageId: el.getAttribute("data-history-message-id") ?? "",
              referenceOffsetTop: el.offsetTop,
            };
            break;
          }
        }
      }
      await handleRefresh();
      setRefreshCounter((c) => c + 1);
    }, [handleRefresh, autoScrollEnabled]),
  };
}
