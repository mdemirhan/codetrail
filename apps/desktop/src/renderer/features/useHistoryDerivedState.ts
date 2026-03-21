import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

import {
  BOOKMARKS_NAV_ID,
  COLLAPSED_PANE_WIDTH,
  EMPTY_CATEGORY_COUNTS,
  HISTORY_CATEGORY_EXPAND_SHORTCUTS,
  HISTORY_CATEGORY_SHORTCUTS,
  PAGE_SIZE,
  PROJECT_ALL_NAV_ID,
} from "../app/constants";
import type {
  BookmarkListResponse,
  BulkExpandScope,
  HistoryMessage,
  ProjectCombinedDetail,
  ProjectSummary,
  SessionDetail,
  SessionPaneNavigationItem,
  SessionSummary,
  SortDirection,
} from "../app/types";
import {
  compareRecent,
  countProviders,
  formatDate,
  prettyCategory,
  prettyProvider,
} from "../lib/viewUtils";

// Pure derived state for the history screen lives here so sorting, counts, labels, and layout math
// remain memoized and testable without mixing them into fetch/interaction code.
export function useHistoryDerivedState({
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
}: {
  historyMode: "session" | "bookmarks" | "project_all";
  sortedProjects: ProjectSummary[];
  sortedSessions: SessionSummary[];
  selectedProjectId: string;
  selectedSessionId: string;
  sessionPaneStableProjectId: string | null;
  bookmarksResponse: BookmarkListResponse;
  bookmarkSortDirection: SortDirection;
  projectCombinedDetail: ProjectCombinedDetail | null;
  sessionDetail: SessionDetail | null;
  projectAllSortDirection: SortDirection;
  messageSortDirection: SortDirection;
  focusMessageId: string;
  sessionPage: number;
  expandedByDefaultCategories: MessageCategory[];
  bulkExpandScope: BulkExpandScope;
  messageExpanded: Record<string, boolean>;
  isHistoryLayout: boolean;
  projectPaneCollapsed: boolean;
  projectPaneWidth: number;
  sessionPaneCollapsed: boolean;
  sessionPaneWidth: number;
}) {
  const bookmarkMessages = useMemo(() => {
    const next = bookmarksResponse.results.map((entry) => entry.message);
    next.sort((left, right) => {
      const byTime =
        compareRecent(left.createdAt, right.createdAt) || left.id.localeCompare(right.id);
      return bookmarkSortDirection === "asc" ? byTime : -byTime;
    });
    return next;
  }, [bookmarksResponse.results, bookmarkSortDirection]);

  const activeMessageSortDirection: SortDirection =
    historyMode === "project_all"
      ? projectAllSortDirection
      : historyMode === "bookmarks"
        ? bookmarkSortDirection
        : messageSortDirection;
  const messageSortScopeLabel =
    historyMode === "project_all"
      ? "all sessions"
      : historyMode === "bookmarks"
        ? "bookmarks"
        : "session";
  const messageSortTooltip =
    activeMessageSortDirection === "asc"
      ? `Oldest first (${messageSortScopeLabel}). Click to switch to newest first.`
      : `Newest first (${messageSortScopeLabel}). Click to switch to oldest first.`;

  const bookmarkOrphanedByMessageId = useMemo(
    () =>
      new Map(
        bookmarksResponse.results.map((entry) => [entry.message.id, entry.isOrphaned] as const),
      ),
    [bookmarksResponse.results],
  );
  const bookmarkedMessageIds = useMemo(
    () => new Set(bookmarksResponse.results.map((entry) => entry.message.id)),
    [bookmarksResponse.results],
  );

  const activeHistoryMessages: HistoryMessage[] = useMemo(() => {
    if (historyMode === "bookmarks") {
      return bookmarkMessages;
    }
    if (historyMode === "project_all") {
      return projectCombinedDetail?.messages ?? [];
    }
    return sessionDetail?.messages ?? [];
  }, [bookmarkMessages, historyMode, projectCombinedDetail?.messages, sessionDetail?.messages]);

  const visibleFocusedMessageId = useMemo(() => {
    if (!focusMessageId) {
      return "";
    }
    return activeHistoryMessages.some((message) => message.id === focusMessageId)
      ? focusMessageId
      : "";
  }, [activeHistoryMessages, focusMessageId]);

  const focusedMessagePosition = useMemo(() => {
    if (!focusMessageId) {
      return -1;
    }
    return activeHistoryMessages.findIndex((message) => message.id === focusMessageId);
  }, [activeHistoryMessages, focusMessageId]);

  const loadedHistoryPage =
    historyMode === "project_all" ? (projectCombinedDetail?.page ?? 0) : (sessionDetail?.page ?? 0);

  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, sortedProjects],
  );
  const selectedSession = useMemo(
    () => sortedSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sortedSessions],
  );
  const allSessionsCount = useMemo(
    () => sortedSessions.reduce((sum, session) => sum + session.messageCount, 0),
    [sortedSessions],
  );
  const isSessionPaneReadyForSelectedProject =
    !selectedProjectId || sessionPaneStableProjectId === selectedProjectId;
  // Keep rendering pinned to the last fully-loaded project to avoid flashing an empty or mixed
  // session pane while the selected project is still fetching.
  const visibleSessionPaneSessions = isSessionPaneReadyForSelectedProject ? sortedSessions : [];
  const visibleSessionPaneBookmarksCount = isSessionPaneReadyForSelectedProject
    ? bookmarksResponse.totalCount
    : 0;
  const visibleSessionPaneAllSessionsCount = isSessionPaneReadyForSelectedProject
    ? allSessionsCount
    : 0;
  const currentViewBookmarkCount =
    historyMode === "bookmarks"
      ? bookmarksResponse.totalCount
      : historyMode === "session"
        ? (selectedSession?.bookmarkCount ?? 0)
        : (selectedProject?.bookmarkCount ?? 0);

  const sessionPaneNavigationItems = useMemo<SessionPaneNavigationItem[]>(() => {
    // The session pane is modeled as one navigation list that includes synthetic entries for
    // project-wide messages and bookmarks alongside real sessions.
    const next: SessionPaneNavigationItem[] = [{ id: PROJECT_ALL_NAV_ID, kind: "project_all" }];
    if (visibleSessionPaneBookmarksCount > 0) {
      next.push({ id: BOOKMARKS_NAV_ID, kind: "bookmarks" });
    }
    next.push(
      ...visibleSessionPaneSessions.map((session) => ({
        id: session.id,
        kind: "session" as const,
        sessionId: session.id,
      })),
    );
    return next;
  }, [visibleSessionPaneBookmarksCount, visibleSessionPaneSessions]);

  const messagePathRoots = useMemo(() => {
    if (!selectedProject?.path) {
      return [];
    }
    return [selectedProject.path];
  }, [selectedProject?.path]);

  const projectProviderCounts = useMemo(
    () => countProviders(sortedProjects.map((project) => project.provider)),
    [sortedProjects],
  );

  const totalPages = useMemo(() => {
    const totalCount =
      historyMode === "project_all"
        ? (projectCombinedDetail?.totalCount ?? 0)
        : (sessionDetail?.totalCount ?? 0);
    if (totalCount === 0) {
      return 1;
    }
    return Math.ceil(totalCount / PAGE_SIZE);
  }, [historyMode, projectCombinedDetail?.totalCount, sessionDetail?.totalCount]);

  const canNavigatePages = historyMode !== "bookmarks";
  const canGoToPreviousHistoryPage = canNavigatePages && sessionPage > 0;
  const canGoToNextHistoryPage = canNavigatePages && sessionPage + 1 < totalPages;

  const historyCategoryCounts =
    historyMode === "bookmarks"
      ? bookmarksResponse.categoryCounts
      : historyMode === "project_all"
        ? (projectCombinedDetail?.categoryCounts ?? EMPTY_CATEGORY_COUNTS)
        : (sessionDetail?.categoryCounts ?? EMPTY_CATEGORY_COUNTS);
  const historyQueryError =
    historyMode === "bookmarks"
      ? (bookmarksResponse.queryError ?? null)
      : historyMode === "project_all"
        ? (projectCombinedDetail?.queryError ?? null)
        : (sessionDetail?.queryError ?? null);
  const historyHighlightPatterns =
    historyMode === "bookmarks"
      ? (bookmarksResponse.highlightPatterns ?? [])
      : historyMode === "project_all"
        ? (projectCombinedDetail?.highlightPatterns ?? [])
        : (sessionDetail?.highlightPatterns ?? []);

  const isExpandedByDefault = useCallback(
    (category: MessageCategory) => expandedByDefaultCategories.includes(category),
    [expandedByDefaultCategories],
  );

  const scopedMessages = useMemo(
    () =>
      bulkExpandScope === "all"
        ? activeHistoryMessages
        : activeHistoryMessages.filter((message) => message.category === bulkExpandScope),
    [activeHistoryMessages, bulkExpandScope],
  );
  const areScopedMessagesExpanded = useMemo(
    () =>
      scopedMessages.length > 0 &&
      scopedMessages.every(
        (message) => messageExpanded[message.id] ?? isExpandedByDefault(message.category),
      ),
    [isExpandedByDefault, messageExpanded, scopedMessages],
  );
  const bulkScopeLabel = useMemo(
    () => (bulkExpandScope === "all" ? "All" : prettyCategory(bulkExpandScope)),
    [bulkExpandScope],
  );
  const scopedActionLabel = areScopedMessagesExpanded ? "Collapse" : "Expand";
  const scopedExpandCollapseLabel = `${scopedActionLabel} ${bulkScopeLabel}`;
  const workspaceStyle = isHistoryLayout
    ? ({
        // Keep user-resized widths in CSS variables so responsive media queries can still take
        // over when zoom shrinks the effective viewport.
        "--project-pane-width": `${
          projectPaneCollapsed ? COLLAPSED_PANE_WIDTH : projectPaneWidth
        }px`,
        "--session-pane-width": `${
          sessionPaneCollapsed ? COLLAPSED_PANE_WIDTH : sessionPaneWidth
        }px`,
      } as CSSProperties)
    : undefined;

  return {
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
    currentViewBookmarkCount,
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
    selectedSummaryMessageCount:
      historyMode === "bookmarks"
        ? `${bookmarksResponse.filteredCount} of ${bookmarksResponse.totalCount} bookmarked messages`
        : historyMode === "project_all"
          ? `${projectCombinedDetail?.totalCount ?? 0} messages`
          : `${sessionDetail?.totalCount ?? 0} messages`,
    historyCategoryExpandShortcutMap: HISTORY_CATEGORY_EXPAND_SHORTCUTS,
    historyCategoriesShortcutMap: HISTORY_CATEGORY_SHORTCUTS,
    prettyCategory,
    prettyProvider,
    formatDate,
  };
}
