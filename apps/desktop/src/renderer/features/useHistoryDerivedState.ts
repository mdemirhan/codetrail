import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

import {
  BOOKMARKS_NAV_ID,
  CATEGORIES,
  COLLAPSED_PANE_WIDTH,
  EMPTY_CATEGORY_COUNTS,
  HISTORY_CATEGORY_EXPAND_SHORTCUTS,
  HISTORY_CATEGORY_SHORTCUTS,
  PROJECT_ALL_NAV_ID,
} from "../app/constants";
import type {
  BookmarkListResponse,
  HistoryMessage,
  ProjectCombinedDetail,
  ProjectSummary,
  SessionDetail,
  SessionPaneNavigationItem,
  SessionSummary,
  SortDirection,
} from "../app/types";
import { formatInteger } from "../lib/numberFormatting";
import {
  compareRecent,
  countProviders,
  formatDate,
  prettyCategory,
  prettyProvider,
} from "../lib/viewUtils";

export function formatSelectedSummaryMessageCount(
  filteredCount: number,
  totalCount: number,
  label: "messages" | "bookmarked messages",
): string {
  return `${formatInteger(filteredCount)} of ${formatInteger(totalCount)} ${label}`;
}

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
  visibleBookmarkedMessageIds,
  bookmarkSortDirection,
  projectCombinedDetail,
  sessionDetail,
  projectAllSortDirection,
  messageSortDirection,
  focusMessageId,
  sessionPage,
  messagePageSize,
  expandedByDefaultCategories,
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
  visibleBookmarkedMessageIds: string[];
  bookmarkSortDirection: SortDirection;
  projectCombinedDetail: ProjectCombinedDetail | null;
  sessionDetail: SessionDetail | null;
  projectAllSortDirection: SortDirection;
  messageSortDirection: SortDirection;
  focusMessageId: string;
  sessionPage: number;
  messagePageSize: number;
  expandedByDefaultCategories: MessageCategory[];
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
  const messageSortTooltip = activeMessageSortDirection === "asc" ? "Oldest first" : "Newest first";

  const bookmarkOrphanedByMessageId = useMemo(
    () =>
      new Map(
        bookmarksResponse.results.map((entry) => [entry.message.id, entry.isOrphaned] as const),
      ),
    [bookmarksResponse.results],
  );
  const bookmarkedMessageIds = useMemo(
    () =>
      new Set(
        historyMode === "bookmarks"
          ? bookmarksResponse.results.map((entry) => entry.message.id)
          : visibleBookmarkedMessageIds,
      ),
    [bookmarksResponse.results, historyMode, visibleBookmarkedMessageIds],
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
    historyMode === "project_all"
      ? (projectCombinedDetail?.page ?? 0)
      : historyMode === "bookmarks"
        ? (bookmarksResponse.page ?? 0)
        : (sessionDetail?.page ?? 0);

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
  const selectedProjectBookmarkCount =
    bookmarksResponse.projectId === selectedProjectId
      ? Math.max(selectedProject?.bookmarkCount ?? 0, bookmarksResponse.totalCount)
      : (selectedProject?.bookmarkCount ?? 0);
  const visibleSessionPaneBookmarksCount = isSessionPaneReadyForSelectedProject
    ? selectedProjectBookmarkCount
    : 0;
  const visibleSessionPaneAllSessionsCount = isSessionPaneReadyForSelectedProject
    ? allSessionsCount
    : 0;
  const currentViewBookmarkCount =
    historyMode === "bookmarks"
      ? bookmarksResponse.totalCount
      : historyMode === "session"
        ? (selectedSession?.bookmarkCount ?? 0)
        : selectedProjectBookmarkCount;

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
      historyMode === "bookmarks"
        ? bookmarksResponse.filteredCount
        : historyMode === "project_all"
          ? (projectCombinedDetail?.totalCount ?? 0)
          : (sessionDetail?.totalCount ?? 0);
    if (totalCount === 0) {
      return 1;
    }
    return Math.ceil(totalCount / messagePageSize);
  }, [
    bookmarksResponse.filteredCount,
    historyMode,
    messagePageSize,
    projectCombinedDetail?.totalCount,
    sessionDetail?.totalCount,
  ]);

  const canNavigatePages = totalPages > 1;
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
  const filteredMessageCount =
    historyMode === "bookmarks"
      ? bookmarksResponse.filteredCount
      : historyMode === "project_all"
        ? (projectCombinedDetail?.totalCount ?? 0)
        : (sessionDetail?.totalCount ?? 0);
  const totalMessageCount =
    historyMode === "bookmarks"
      ? bookmarksResponse.totalCount
      : historyMode === "project_all"
        ? (selectedProject?.messageCount ?? 0)
        : (selectedSession?.messageCount ?? sessionDetail?.session?.messageCount ?? 0);

  const isExpandedByDefault = useCallback(
    (category: MessageCategory) => expandedByDefaultCategories.includes(category),
    [expandedByDefaultCategories],
  );

  const areAllMessagesExpanded = useMemo(
    () => CATEGORIES.every((category) => isExpandedByDefault(category)),
    [isExpandedByDefault],
  );
  const globalExpandCollapseLabel = areAllMessagesExpanded ? "Collapse" : "Expand";
  const workspaceStyle = isHistoryLayout
    ? ({
        // Keep user-resized widths in CSS variables so responsive media queries can still take
        // over when zoom shrinks the effective viewport.
        "--project-pane-width": `${
          projectPaneCollapsed ? COLLAPSED_PANE_WIDTH : projectPaneWidth
        }px`,
        "--project-pane-min-width": `${projectPaneCollapsed ? COLLAPSED_PANE_WIDTH : 230}px`,
        "--session-pane-width": `${
          sessionPaneCollapsed ? COLLAPSED_PANE_WIDTH : sessionPaneWidth
        }px`,
        "--session-pane-min-width": `${sessionPaneCollapsed ? COLLAPSED_PANE_WIDTH : 250}px`,
      } as CSSProperties)
    : undefined;

  return {
    activeMessageSortDirection,
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
    areAllMessagesExpanded,
    globalExpandCollapseLabel,
    workspaceStyle,
    selectedSummaryMessageCount:
      historyMode === "bookmarks"
        ? formatSelectedSummaryMessageCount(
            bookmarksResponse.filteredCount,
            bookmarksResponse.totalCount,
            "bookmarked messages",
          )
        : formatSelectedSummaryMessageCount(filteredMessageCount, totalMessageCount, "messages"),
    historyCategoryExpandShortcutMap: HISTORY_CATEGORY_EXPAND_SHORTCUTS,
    historyCategoriesShortcutMap: HISTORY_CATEGORY_SHORTCUTS,
    prettyCategory,
    prettyProvider,
    formatDate,
  };
}
