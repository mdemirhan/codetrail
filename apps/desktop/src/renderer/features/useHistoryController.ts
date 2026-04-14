import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core/browser";

import {
  CATEGORIES,
  DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES,
  EMPTY_BOOKMARKS_RESPONSE,
  MESSAGE_ID_BATCH_SIZE,
} from "../app/constants";
import {
  createHistorySelection,
  setHistorySelectionProjectId,
  setHistorySelectionSessionId,
} from "../app/historySelection";
import type {
  BookmarkListResponse,
  HistorySearchNavigation,
  HistorySelection,
  HistoryVisualization,
  PaneStateSnapshot,
  PendingMessagePageNavigation,
  PendingRevealTarget,
  ProjectCombinedDetail,
  SessionDetail,
  TreeAutoRevealSessionRequest,
} from "../app/types";
import {
  type TurnCombinedMessage,
  aggregateTurnCombinedFiles,
} from "../components/history/turnCombinedDiff";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePaneStateSync } from "../hooks/usePaneStateSync";
import { useCodetrailClient } from "../lib/codetrailClient";
import type { HistoryPaneId } from "../lib/paneFocusController";
import type { StableListUpdateSource } from "../lib/projectUpdates";
import type { AppearanceState } from "./historyControllerShared";
import type { RefreshContext } from "./historyControllerTypes";
import {
  type VisibleExpansionAction,
  deriveVisibleExpansionAction,
  getNextVisibleExpansionAction,
} from "./historyVisibleExpansion";
import { useHistoryCatalogController } from "./useHistoryCatalogController";
import { useHistoryDataEffects } from "./useHistoryDataEffects";
import { useHistoryDerivedState } from "./useHistoryDerivedState";
import { useHistoryExportController } from "./useHistoryExportController";
import { useHistoryInteractions } from "./useHistoryInteractions";
import { useHistoryPanePreferences } from "./useHistoryPanePreferences";
import { useHistoryRefreshController } from "./useHistoryRefreshController";
import {
  type HistorySelectionDebounceOverrides,
  useHistorySelectionState,
} from "./useHistorySelectionState";
import { useHistoryTurnController } from "./useHistoryTurnController";

const TURN_PRIMARY_HISTORY_CATEGORIES: readonly MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
];
function turnHasCombinedVisibleDiffs(messages: TurnCombinedMessage[]): boolean {
  return (
    aggregateTurnCombinedFiles(messages.filter((message) => message.category !== "user")).length > 0
  );
}

export type { HistorySelectionDebounceOverrides } from "./useHistorySelectionState";

const MESSAGE_PAGE_SCROLL_OVERLAP_PX = 20;

// ── Periodic-refresh scroll policy ──────────────────────────────────────────
//
// There is no manual auto-scroll toggle. Instead, auto-follow is detected
// automatically based on scroll position and pagination state at refresh time:
//
//   Visual edge:
//     ASC sort → bottom (within threshold)
//     DESC sort → top (within threshold)
//
//   Live-edge page:
//     ASC sort → last page
//     DESC sort → page 0
//
// Auto-follow is only eligible when the selected scope is both visually pinned
// and already on its live-edge page. Visual top/bottom alone is not enough.
// Unrelated project updates may refresh badges and ordering, but they must not
// move the current page.
//
// Follow-eligible refresh with growth in the selected scope:
//   Navigate to the page containing the newest messages (last page for ASC,
//   page 0 for DESC) and scroll to the corresponding edge. If message IDs
//   haven't changed since the previous tick, skip the scroll entirely.
//
// Any other refresh:
//   Re-fetch the *same* sessionPage number. Drift compensation keeps the
//   viewport pixel-stable via an anchor element. If the page goes out of
//   range the server clamps to the last valid page.
//
// Race protection:
//   refreshContextRef carries a monotonic refreshId. If a newer refresh
//   starts, or the user navigates (clearing the ref), stale responses are
//   discarded. A separate clearing-effect invalidates the ref when user-
//   driven deps (sort, filter, query) change.
// ────────────────────────────────────────────────────────────────────────────

// useHistoryController is the stateful coordinator for the history UI. It owns selection, pane
// layout, persisted UI state, data loading hooks, and keyboard/navigation wiring.
export function useHistoryController({
  initialPaneState,
  isHistoryLayout,
  searchMode,
  enabledProviders,
  setEnabledProviders,
  searchProviders,
  setSearchProviders,
  appearance,
  logError,
  testHistorySelectionDebounceOverrides = null,
  focusHistoryPane,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  isHistoryLayout: boolean;
  searchMode: SearchMode;
  enabledProviders: Provider[];
  setEnabledProviders: Dispatch<SetStateAction<Provider[]>>;
  searchProviders: Provider[];
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  appearance: AppearanceState;
  logError: (context: string, error: unknown) => void;
  testHistorySelectionDebounceOverrides?: HistorySelectionDebounceOverrides | null;
  focusHistoryPane: (pane: HistoryPaneId, options?: { preventScroll?: boolean }) => void;
}) {
  const codetrail = useCodetrailClient();

  const [projectQueryInput, setProjectQueryInput] = useState("");
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
  const [visibleBookmarkedMessageIds, setVisibleBookmarkedMessageIds] = useState<string[]>([]);
  const [bookmarkStatesRefreshNonce, setBookmarkStatesRefreshNonce] = useState(0);
  const [sessionPage, setSessionPage] = useState(initialPaneState?.sessionPage ?? 0);
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [bookmarkQueryInput, setBookmarkQueryInput] = useState("");
  const [turnViewCombinedChangesExpandedOverride, setTurnViewCombinedChangesExpandedOverride] =
    useState<boolean | null>(null);
  const [visibleExpansionActionState, setVisibleExpansionActionState] =
    useState<VisibleExpansionAction>("expand");
  const [combinedChangesDiffExpansionRequest, setCombinedChangesDiffExpansionRequest] = useState<{
    expanded: boolean;
    version: number;
  } | null>(null);
  const visibleExpansionScopeKeyRef = useRef("");
  const visibleExpansionItemCountRef = useRef(0);
  const combinedChangesDiffScopeKeyRef = useRef("");
  const [combinedChangesDiffState, setCombinedChangesDiffState] = useState<{
    hasVisibleDiffs: boolean;
    allExpanded: boolean;
  }>({
    hasVisibleDiffs: false,
    allExpanded: false,
  });
  const [bookmarkReturnSelection, setBookmarkReturnSelection] = useState<HistorySelection | null>(
    null,
  );
  const [messageExpansionOverrides, setMessageExpansionOverrides] = useState<
    Record<string, boolean>
  >({});
  const [focusMessageId, setFocusMessageId] = useState("");
  const [pendingRevealTarget, setPendingRevealTarget] = useState<PendingRevealTarget | null>(null);
  const [autoRevealSessionRequest, setAutoRevealSessionRequest] =
    useState<TreeAutoRevealSessionRequest | null>(null);
  const [pendingMessageAreaFocus, setPendingMessageAreaFocus] = useState(false);
  const [pendingMessagePageNavigation, setPendingMessagePageNavigation] =
    useState<PendingMessagePageNavigation | null>(null);
  const [pendingSearchNavigation, setPendingSearchNavigation] =
    useState<HistorySearchNavigation | null>(null);
  const [sessionDetailRefreshNonce, setSessionDetailRefreshNonce] = useState(0);
  const [projectCombinedDetailRefreshNonce, setProjectCombinedDetailRefreshNonce] = useState(0);

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
  const bookmarksLoadTokenRef = useRef(0);
  const activeHistoryMessageIdsRef = useRef<string[]>([]);
  const bookmarkStateRequestKeyRef = useRef("");
  const sessionScrollSyncTimerRef = useRef<number | null>(null);
  const refreshContextRef = useRef<RefreshContext | null>(null);
  const {
    selection,
    committedSelection,
    pendingProjectPaneFocusCommitModeRef,
    pendingProjectPaneFocusWaitForKeyboardIdleRef,
    clearSelectionCommitTimer,
    queueSelectionNoopCommit,
    setHistorySelectionImmediate,
    setHistorySelectionWithCommitMode,
    consumeProjectPaneFocusSelectionBehavior,
  } = useHistorySelectionState(initialPaneState, testHistorySelectionDebounceOverrides);

  const {
    initialSessionScrollTop,
    sessionScrollTop,
    setSessionScrollTop,
    projectProviders,
    setProjectProviders,
    removeMissingSessionsDuringIncrementalIndexing,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    systemMessageRegexRules,
    setSystemMessageRegexRules,
    projectViewMode,
    setProjectViewMode,
    projectSortField,
    setProjectSortField,
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
    turnViewSortDirection,
    setTurnViewSortDirection,
    preferredAutoRefreshStrategy,
    setPreferredAutoRefreshStrategy,
    historyCategories,
    setHistoryCategories,
    historyCategoriesRef,
    historyCategorySoloRestoreRef,
    expandedByDefaultCategories,
    setExpandedByDefaultCategories,
    turnViewCategories,
    setTurnViewCategories,
    turnViewCategoriesRef,
    turnViewCategorySoloRestoreRef,
    turnViewExpandedByDefaultCategories,
    setTurnViewExpandedByDefaultCategories,
    turnViewCombinedChangesExpanded,
    setTurnViewCombinedChangesExpanded,
    historyVisualization,
    setHistoryVisualization,
    historyDetailMode,
    liveWatchEnabled,
    setLiveWatchEnabled,
    liveWatchRowHasBackground,
    setLiveWatchRowHasBackground,
    claudeHooksPrompted,
    setClaudeHooksPrompted,
    projectPaneCollapsed,
    setProjectPaneCollapsed,
    sessionPaneCollapsed,
    setSessionPaneCollapsed,
    singleClickFoldersExpand,
    setSingleClickFoldersExpand,
    singleClickProjectsExpand,
    setSingleClickProjectsExpand,
    hideSessionsPaneInTreeView,
    setHideSessionsPaneInTreeView,
    hideSessionsPaneForTreeView,
    projectPaneWidth,
    setProjectPaneWidth,
    sessionPaneWidth,
    setSessionPaneWidth,
    beginResize,
  } = useHistoryPanePreferences({
    initialPaneState,
    isHistoryLayout,
    enabledProviders,
  });
  const sessionScrollTopRef = useRef(initialSessionScrollTop);

  const rawUiSelectedProjectId = selection.projectId;
  const uiHistoryMode = selection.mode;
  const historyMode = committedSelection.mode;
  const {
    projects,
    setProjects,
    projectsRef,
    projectsLoadTokenRef,
    projectsLoaded,
    setProjectsLoaded,
    projectListUpdateSource,
    setProjectListUpdateSource,
    projectUpdates,
    sessions,
    setSessions,
    sessionsLoadTokenRef,
    sessionsLoadedProjectId,
    setSessionsLoadedProjectId,
    sessionListUpdateSource,
    setSessionListUpdateSource,
    treeProjectSessionsByProjectIdRef,
    treeProjectSessionsByProjectId: sortedTreeProjectSessionsByProjectId,
    treeProjectSessionsLoadingByProjectId,
    sortedProjects,
    sortedSessions,
    selectedProjectId,
    uiSelectedProjectId,
    selectedSessionId,
    uiSelectedSessionId,
    queueProjectTreeNoopCommit,
    ensureTreeProjectSessionsLoaded,
    refreshTreeProjectSessions,
    registerAutoProjectUpdates,
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder,
    handleToggleAllFolders,
    toggleTreeProjectExpansion,
  } = useHistoryCatalogController({
    initialPaneState,
    codetrail,
    logError,
    enabledProviders,
    projectProviders,
    projectQuery,
    projectQueryInput,
    projectSortField,
    projectSortDirection,
    sessionSortDirection,
    uiSelection: selection,
    committedSelection,
    projectViewMode,
    autoRevealSessionRequest,
    setAutoRevealSessionRequest,
    pendingProjectPaneFocusCommitModeRef,
    pendingProjectPaneFocusWaitForKeyboardIdleRef,
    queueSelectionNoopCommit,
  });
  const currentHistorySelection = useMemo(
    () => createHistorySelection(historyMode, selectedProjectId, selectedSessionId),
    [historyMode, selectedProjectId, selectedSessionId],
  );
  const currentUiHistorySelection = useMemo(
    () => createHistorySelection(uiHistoryMode, uiSelectedProjectId, uiSelectedSessionId),
    [uiHistoryMode, uiSelectedProjectId, uiSelectedSessionId],
  );

  const paneAppearanceState = useMemo(
    () => ({
      theme: appearance.theme,
      darkShikiTheme: appearance.darkShikiTheme,
      lightShikiTheme: appearance.lightShikiTheme,
      monoFontFamily: appearance.monoFontFamily,
      regularFontFamily: appearance.regularFontFamily,
      monoFontSize: appearance.monoFontSize,
      regularFontSize: appearance.regularFontSize,
      messagePageSize: appearance.messagePageSize,
      useMonospaceForAllMessages: appearance.useMonospaceForAllMessages,
      autoHideMessageActions: appearance.autoHideMessageActions,
      expandPreviewOnHiddenActions: appearance.expandPreviewOnHiddenActions,
      autoHideViewerHeaderActions: appearance.autoHideViewerHeaderActions,
      defaultViewerWrapMode: appearance.defaultViewerWrapMode,
      defaultDiffViewMode: appearance.defaultDiffViewMode,
      collapseMultiFileToolDiffs: appearance.collapseMultiFileToolDiffs,
      preferredExternalEditor: appearance.preferredExternalEditor,
      preferredExternalDiffTool: appearance.preferredExternalDiffTool,
      terminalAppCommand: appearance.terminalAppCommand,
      externalTools: appearance.externalTools,
    }),
    [
      appearance.darkShikiTheme,
      appearance.externalTools,
      appearance.lightShikiTheme,
      appearance.monoFontFamily,
      appearance.monoFontSize,
      appearance.messagePageSize,
      appearance.preferredExternalDiffTool,
      appearance.preferredExternalEditor,
      appearance.terminalAppCommand,
      appearance.regularFontFamily,
      appearance.regularFontSize,
      appearance.theme,
      appearance.useMonospaceForAllMessages,
      appearance.autoHideMessageActions,
      appearance.expandPreviewOnHiddenActions,
      appearance.autoHideViewerHeaderActions,
      appearance.defaultViewerWrapMode,
      appearance.defaultDiffViewMode,
      appearance.collapseMultiFileToolDiffs,
    ],
  );

  const paneLayoutState = useMemo(
    () => ({
      projectPaneWidth,
      sessionPaneWidth,
      projectPaneCollapsed,
      sessionPaneCollapsed,
      singleClickFoldersExpand,
      singleClickProjectsExpand,
      hideSessionsPaneInTreeView,
      sessionScrollTop,
      projectViewMode,
    }),
    [
      projectPaneCollapsed,
      projectPaneWidth,
      projectViewMode,
      sessionPaneCollapsed,
      sessionPaneWidth,
      sessionScrollTop,
      singleClickFoldersExpand,
      singleClickProjectsExpand,
      hideSessionsPaneInTreeView,
    ],
  );

  const paneFilterState = useMemo(
    () => ({
      enabledProviders,
      removeMissingSessionsDuringIncrementalIndexing,
      projectProviders,
      historyCategories,
      expandedByDefaultCategories,
      turnViewCategories,
      turnViewExpandedByDefaultCategories,
      turnViewCombinedChangesExpanded,
      searchProviders,
      liveWatchEnabled,
      liveWatchRowHasBackground,
      claudeHooksPrompted,
      preferredAutoRefreshStrategy,
      systemMessageRegexRules,
    }),
    [
      enabledProviders,
      expandedByDefaultCategories,
      historyCategories,
      liveWatchEnabled,
      liveWatchRowHasBackground,
      claudeHooksPrompted,
      preferredAutoRefreshStrategy,
      projectProviders,
      removeMissingSessionsDuringIncrementalIndexing,
      searchProviders,
      systemMessageRegexRules,
      turnViewCategories,
      turnViewExpandedByDefaultCategories,
      turnViewCombinedChangesExpanded,
    ],
  );

  const paneSelectionState = useMemo(
    () => ({
      selectedProjectId,
      selectedSessionId,
      historyMode,
      historyVisualization,
      historyDetailMode,
      sessionPage,
    }),
    [
      historyDetailMode,
      historyMode,
      historyVisualization,
      selectedProjectId,
      selectedSessionId,
      sessionPage,
    ],
  );

  const paneSortState = useMemo(
    () => ({
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
      messageSortDirection,
      bookmarkSortDirection,
      projectAllSortDirection,
      turnViewSortDirection,
    }),
    [
      bookmarkSortDirection,
      messageSortDirection,
      projectAllSortDirection,
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
      turnViewSortDirection,
    ],
  );

  const paneStateForSync = useMemo(
    () => ({
      // Keep the persisted snapshot derived from the controller's canonical selection state so
      // restoration does not drift from what the UI is actually rendering.
      ...paneFilterState,
      ...paneLayoutState,
      ...paneAppearanceState,
      ...paneSelectionState,
      ...paneSortState,
    }),
    [paneAppearanceState, paneFilterState, paneLayoutState, paneSelectionState, paneSortState],
  );

  const setSelectedProjectIdForPaneStateSync = useCallback(
    (value: SetStateAction<string>) => {
      setHistorySelectionImmediate((selectionState) =>
        typeof value === "function"
          ? setHistorySelectionProjectId(selectionState, value(selectionState.projectId))
          : setHistorySelectionProjectId(selectionState, value),
      );
    },
    [setHistorySelectionImmediate],
  );

  const setSelectedSessionIdForPaneStateSync = useCallback(
    (value: SetStateAction<string>) => {
      setHistorySelectionImmediate((selectionState) =>
        typeof value === "function"
          ? setHistorySelectionSessionId(
              selectionState,
              value("sessionId" in selectionState ? (selectionState.sessionId ?? "") : ""),
            )
          : setHistorySelectionSessionId(selectionState, value),
      );
    },
    [setHistorySelectionImmediate],
  );

  const setHistoryModeForPaneStateSync = useCallback(
    (value: SetStateAction<HistorySelection["mode"]>) => {
      setHistorySelectionImmediate((selectionState) =>
        createHistorySelection(
          typeof value === "function" ? value(selectionState.mode) : value,
          selectionState.projectId,
          "sessionId" in selectionState ? (selectionState.sessionId ?? "") : "",
        ),
      );
    },
    [setHistorySelectionImmediate],
  );

  const { paneStateHydrated } = usePaneStateSync({
    initialPaneStateHydrated: initialPaneState !== null,
    logError,
    paneState: paneStateForSync,
    setEnabledProviders,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setSingleClickFoldersExpand,
    setSingleClickProjectsExpand,
    setHideSessionsPaneInTreeView,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setTurnViewCategories,
    setTurnViewExpandedByDefaultCategories,
    setTurnViewCombinedChangesExpanded,
    setSearchProviders,
    setLiveWatchEnabled,
    setLiveWatchRowHasBackground,
    setClaudeHooksPrompted,
    setPreferredAutoRefreshStrategy,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    setTheme: appearance.setTheme,
    setDarkShikiTheme: appearance.setDarkShikiTheme,
    setLightShikiTheme: appearance.setLightShikiTheme,
    setMonoFontFamily: appearance.setMonoFontFamily,
    setRegularFontFamily: appearance.setRegularFontFamily,
    setMonoFontSize: appearance.setMonoFontSize,
    setRegularFontSize: appearance.setRegularFontSize,
    setMessagePageSize: appearance.setMessagePageSize,
    setUseMonospaceForAllMessages: appearance.setUseMonospaceForAllMessages,
    setAutoHideMessageActions: appearance.setAutoHideMessageActions,
    setExpandPreviewOnHiddenActions: appearance.setExpandPreviewOnHiddenActions,
    setAutoHideViewerHeaderActions: appearance.setAutoHideViewerHeaderActions,
    setDefaultViewerWrapMode: appearance.setDefaultViewerWrapMode,
    setDefaultDiffViewMode: appearance.setDefaultDiffViewMode,
    setCollapseMultiFileToolDiffs: appearance.setCollapseMultiFileToolDiffs,
    setPreferredExternalEditor: appearance.setPreferredExternalEditor,
    setPreferredExternalDiffTool: appearance.setPreferredExternalDiffTool,
    setTerminalAppCommand: appearance.setTerminalAppCommand,
    setExternalTools: appearance.setExternalTools,
    setHistorySelection: setHistorySelectionImmediate,
    setSelectedProjectId: setSelectedProjectIdForPaneStateSync,
    setSelectedSessionId: setSelectedSessionIdForPaneStateSync,
    setHistoryMode: setHistoryModeForPaneStateSync,
    setHistoryVisualization,
    setProjectViewMode,
    setProjectSortField,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setTurnViewSortDirection,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

  const { loadProjects, loadSessions, loadBookmarks } = useHistoryDataEffects({
    codetrail,
    logError,
    projectProviders,
    projectQuery,
    rawSelectedProjectId: rawUiSelectedProjectId,
    selectedProjectId,
    selectedSessionId,
    sortedProjects,
    sortedSessions,
    pendingSearchNavigation,
    setPendingSearchNavigation,
    setHistorySelection: setHistorySelectionImmediate,
    setProjects,
    projectsRef,
    setProjectListUpdateSource,
    registerAutoProjectUpdates,
    setProjectsLoaded,
    projectsLoaded,
    setSessions,
    setSessionListUpdateSource,
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
    bookmarkSortDirection,
    messageSortDirection,
    projectAllSortDirection,
    sessionPage,
    messagePageSize: appearance.messagePageSize,
    setSessionDetail,
    setProjectCombinedDetail,
    bookmarksLoadedProjectId,
    bookmarksResponse,
    setSessionPaneStableProjectId,
    sessionsLoadedProjectId,
    projectsLoadTokenRef,
    sessionsLoadTokenRef,
    bookmarksLoadTokenRef,
    sessionDetailRefreshNonce,
    projectCombinedDetailRefreshNonce,
    refreshContextRef,
  });

  useEffect(() => {
    return () => {
      if (sessionScrollSyncTimerRef.current !== null) {
        window.clearTimeout(sessionScrollSyncTimerRef.current);
      }
      clearSelectionCommitTimer();
    };
  }, [clearSelectionCommitTimer]);

  const {
    activeMessageSortDirection,
    messageSortTooltip,
    bookmarkOrphanedByMessageId,
    bookmarkedMessageIds,
    activeHistoryMessages,
    visibleFocusedMessageId: visibleFocusedMessageIdFlat,
    focusedMessagePosition: focusedMessagePositionFlat,
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
    areAllMessagesExpanded: areAllMessagesExpandedFlat,
    globalExpandCollapseLabel: globalExpandCollapseLabelFlat,
    workspaceStyle,
    selectedSummaryMessageCount,
    historyCategoryExpandShortcutMap,
    historyCategoriesShortcutMap,
    historyCategorySoloShortcutMap,
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
    visibleBookmarkedMessageIds,
    bookmarkSortDirection,
    projectCombinedDetail,
    sessionDetail,
    projectAllSortDirection,
    messageSortDirection,
    focusMessageId,
    sessionPage,
    messagePageSize: appearance.messagePageSize,
    historyCategories,
    expandedByDefaultCategories,
    isHistoryLayout,
    projectPaneCollapsed,
    projectPaneWidth,
    sessionPaneCollapsed,
    sessionPaneWidth,
  });
  const {
    turnQueryInput,
    setTurnQueryInput,
    effectiveTurnQuery,
    turnAnchorMessageId,
    turnSourceSessionId,
    sessionTurnDetail,
    turnAnchorMessage,
    turnVisibleMessages,
    turnCategoryCounts,
    turnDisplayPage,
    turnTotalPages,
    turnVisualizationSelection,
    currentTurnScopeKey,
    canToggleTurnView,
    clearTurnViewState,
    requestTurnDetailRefresh,
    handleRevealInTurn,
    handleSelectMessagesView,
    handleSelectTurnsView,
    handleToggleTurnView,
    goToPreviousTurn,
    goToNextTurn,
    goToFirstTurn,
    goToLatestTurn,
    goToTurnNumber,
  } = useHistoryTurnController({
    codetrail,
    logError,
    searchMode,
    historyDetailMode,
    currentUiHistorySelection,
    selectedProjectId,
    selectedSessionId,
    turnViewSortDirection,
    turnViewCategories,
    setTurnViewCombinedChangesExpandedOverride,
    setHistorySelectionImmediate,
    setHistoryVisualization,
    setFocusMessageId,
  });
  const activeHistoryMessageIds = useMemo(
    () => activeHistoryMessages.map((message) => message.id),
    [activeHistoryMessages],
  );
  const detailMessages = historyDetailMode === "turn" ? turnVisibleMessages : activeHistoryMessages;
  const detailMessageIds = useMemo(
    () => detailMessages.map((message) => message.id),
    [detailMessages],
  );
  const turnSourceSession = useMemo(() => {
    if (!turnSourceSessionId) {
      return null;
    }
    const listedSession = sortedSessions.find((session) => session.id === turnSourceSessionId);
    if (listedSession) {
      return listedSession;
    }
    for (const projectSessions of Object.values(sortedTreeProjectSessionsByProjectId)) {
      const matchedSession = projectSessions.find((session) => session.id === turnSourceSessionId);
      if (matchedSession) {
        return matchedSession;
      }
    }
    return null;
  }, [sortedSessions, sortedTreeProjectSessionsByProjectId, turnSourceSessionId]);
  const visibleFocusedMessageId = useMemo(() => {
    if (!focusMessageId) {
      return "";
    }
    return detailMessages.some((message) => message.id === focusMessageId) ? focusMessageId : "";
  }, [detailMessages, focusMessageId]);
  const focusedMessagePosition = useMemo(() => {
    if (!focusMessageId) {
      return -1;
    }
    return detailMessages.findIndex((message) => message.id === focusMessageId);
  }, [detailMessages, focusMessageId]);
  const stableActiveHistoryMessageIds = useMemo(() => {
    const previousIds = activeHistoryMessageIdsRef.current;
    if (
      previousIds.length === detailMessageIds.length &&
      previousIds.every((messageId, index) => messageId === detailMessageIds[index])
    ) {
      return previousIds;
    }
    return detailMessageIds;
  }, [detailMessageIds]);
  const stableActiveHistoryMessageIdsSignature = useMemo(
    () => stableActiveHistoryMessageIds.join("\u0000"),
    [stableActiveHistoryMessageIds],
  );
  const bookmarkStateRequestKey = useMemo(
    () =>
      `${selectedProjectId ?? ""}\u0001${historyMode}\u0001${bookmarkStatesRefreshNonce}\u0001${stableActiveHistoryMessageIdsSignature}`,
    [
      bookmarkStatesRefreshNonce,
      historyMode,
      selectedProjectId,
      stableActiveHistoryMessageIdsSignature,
    ],
  );

  useEffect(() => {
    historyCategoriesRef.current = historyCategories;
  }, [historyCategories, historyCategoriesRef]);

  useEffect(() => {
    turnViewCategoriesRef.current = turnViewCategories;
  }, [turnViewCategories, turnViewCategoriesRef]);

  useEffect(() => {
    if (historyVisualization === "turns") {
      return;
    }
    if (historyVisualization === "bookmarks") {
      if (historyMode === "bookmarks" || !selectedProjectId) {
        return;
      }
      setHistorySelectionImmediate(
        createHistorySelection(
          "bookmarks",
          selectedProjectId,
          historyMode === "session" ? selectedSessionId : "",
        ),
      );
      return;
    }
    if (historyMode === "bookmarks") {
      setHistorySelectionImmediate(
        createHistorySelection(
          selectedSessionId ? "session" : "project_all",
          selectedProjectId,
          selectedSessionId,
        ),
      );
    }
  }, [
    historyMode,
    historyVisualization,
    selectedProjectId,
    selectedSessionId,
    setHistorySelectionImmediate,
  ]);

  useEffect(() => {
    activeHistoryMessageIdsRef.current = stableActiveHistoryMessageIds;
  }, [stableActiveHistoryMessageIds]);

  useEffect(() => {
    bookmarkStateRequestKeyRef.current = bookmarkStateRequestKey;
  }, [bookmarkStateRequestKey]);

  useEffect(() => {
    const visibleMessageIds = new Set(detailMessages.map((message) => message.id));
    setMessageExpansionOverrides((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [messageId, expanded] of Object.entries(current)) {
        if (!visibleMessageIds.has(messageId)) {
          changed = true;
          continue;
        }
        next[messageId] = expanded;
      }
      return changed ? next : current;
    });
  }, [detailMessages]);

  useEffect(() => {
    if (!selectedProjectId) {
      setVisibleBookmarkedMessageIds([]);
      return;
    }
    if (historyMode === "bookmarks" && historyDetailMode !== "turn") {
      setVisibleBookmarkedMessageIds(
        bookmarksResponse.projectId === selectedProjectId
          ? bookmarksResponse.results.map((entry) => entry.message.id)
          : [],
      );
      return;
    }

    if (stableActiveHistoryMessageIds.length === 0) {
      setVisibleBookmarkedMessageIds([]);
      return;
    }

    let cancelled = false;
    const requestKey = bookmarkStateRequestKey;
    const loadBookmarkStates = async () => {
      const collected = new Set<string>();
      for (
        let index = 0;
        index < stableActiveHistoryMessageIds.length;
        index += MESSAGE_ID_BATCH_SIZE
      ) {
        const batch = stableActiveHistoryMessageIds.slice(index, index + MESSAGE_ID_BATCH_SIZE);
        const response = await codetrail.invoke("bookmarks:getStates", {
          projectId: selectedProjectId,
          messageIds: batch,
        });
        for (const messageId of response.bookmarkedMessageIds) {
          collected.add(messageId);
        }
      }
      return Array.from(collected);
    };

    void loadBookmarkStates()
      .then((bookmarkedMessageIds) => {
        if (!cancelled && bookmarkStateRequestKeyRef.current === requestKey) {
          setVisibleBookmarkedMessageIds(bookmarkedMessageIds);
        }
      })
      .catch(() => {
        if (!cancelled && bookmarkStateRequestKeyRef.current === requestKey) {
          setVisibleBookmarkedMessageIds([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bookmarkStateRequestKey,
    bookmarksResponse.projectId,
    bookmarksResponse.results,
    codetrail,
    historyDetailMode,
    historyMode,
    selectedProjectId,
    stableActiveHistoryMessageIds,
  ]);

  const refreshVisibleBookmarkStates = useCallback(() => {
    setBookmarkStatesRefreshNonce((value) => value + 1);
  }, []);

  const requestSessionDetailRefresh = useCallback(() => {
    setSessionDetailRefreshNonce((value) => value + 1);
  }, []);

  const requestProjectCombinedDetailRefresh = useCallback(() => {
    setProjectCombinedDetailRefreshNonce((value) => value + 1);
  }, []);
  const clearRefreshContext = useCallback(() => {
    refreshContextRef.current = null;
  }, []);

  const {
    handleToggleHistoryCategoryShortcut: handleToggleHistoryCategoryShortcutFlat,
    handleSoloHistoryCategoryShortcut: handleSoloHistoryCategoryShortcutFlat,
    handleTogglePrimaryHistoryCategoriesShortcut: handleTogglePrimaryHistoryCategoriesShortcutFlat,
    handleToggleAllHistoryCategoriesShortcut: handleToggleAllHistoryCategoriesShortcutFlat,
    handleFocusPrimaryHistoryCategoriesShortcut: handleFocusPrimaryHistoryCategoriesShortcutFlat,
    handleFocusAllHistoryCategoriesShortcut: handleFocusAllHistoryCategoriesShortcutFlat,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleCategoryDefaultExpansion: handleToggleCategoryDefaultExpansionFlat,
    handleToggleMessageExpanded,
    handleRevealInSession,
    handleRevealInProject,
    handleRevealInBookmarks,
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
    goToHistoryPage,
    goToFirstHistoryPage,
    goToLastHistoryPage,
    goToPreviousHistoryPage,
    goToNextHistoryPage,
    focusAdjacentHistoryMessage,
    handleCopySessionDetails,
    handleCopyProjectDetails,
    focusSessionSearch,
    handleRefresh,
    navigateFromSearchResult,
  } = useHistoryInteractions({
    common: {
      codetrail,
      logError,
      clearRefreshContext,
    },
    categories: {
      setMessageExpanded: setMessageExpansionOverrides,
      setHistoryCategories,
      historyCategoriesRef,
      historyCategorySoloRestoreRef,
      setExpandedByDefaultCategories,
      isExpandedByDefault,
      historyCategories,
    },
    selection: {
      historyMode: uiHistoryMode,
      historyVisualization,
      selection,
      bookmarkReturnSelection,
      selectedProjectId: uiSelectedProjectId,
      selectedSessionId: uiSelectedSessionId,
      setPendingSearchNavigation,
      setSessionQueryInput,
      setBookmarkQueryInput,
      setFocusMessageId,
      setPendingRevealTarget,
      setPendingMessageAreaFocus,
      setPendingMessagePageNavigation,
      setSessionPage,
      setHistorySelection: (value, options) =>
        setHistorySelectionWithCommitMode(
          value,
          options?.commitMode ?? "immediate",
          options?.waitForKeyboardIdle ?? false,
        ),
      setHistoryVisualization,
      setBookmarkReturnSelection,
    },
    projectPane: {
      projectListRef,
      sortedProjects,
      projectViewMode,
      projectPaneCollapsed,
      setProjectPaneCollapsed,
      sessionPaneCollapsed,
      hideSessionsPaneForTreeView,
      setProjectViewMode,
      setAutoRevealSessionRequest,
      pendingProjectPaneFocusCommitModeRef,
      pendingProjectPaneFocusWaitForKeyboardIdleRef,
      queueProjectTreeNoopCommit,
      treeFocusedRow,
      setTreeFocusedRow,
    },
    sessionPane: {
      sessionPaneNavigationItems,
      focusSessionPane: () => focusHistoryPane("session"),
      sessionSearchInputRef,
    },
    loaders: {
      loadBookmarks,
      loadProjects,
      loadSessions,
      refreshTreeProjectSessions,
      refreshVisibleBookmarkStates,
      setProjectProviders,
      setProjectQueryInput,
    },
    viewport: {
      messageListRef,
      sessionScrollTopRef,
      sessionScrollSyncTimerRef,
      setSessionScrollTop,
    },
    paging: {
      bookmarksResponse,
      activeHistoryMessages: detailMessages,
      canNavigatePages,
      totalPages,
      canGoToNextHistoryPage,
      canGoToPreviousHistoryPage,
      visibleFocusedMessageId,
      sessionPage,
      messagePageSize: appearance.messagePageSize,
      selectedSession,
      selectedProject,
      sessionDetailTotalCount: sessionDetail?.totalCount,
      allSessionsCount,
    },
  });

  const handleRevealInSessionWithTurnExit = useCallback(
    (messageId: string, sourceId: string) => {
      setHistoryVisualization("messages");
      clearTurnViewState();
      handleRevealInSession(messageId, sourceId);
    },
    [clearTurnViewState, handleRevealInSession, setHistoryVisualization],
  );

  const handleRevealInProjectWithTurnExit = useCallback(
    (messageId: string, sourceId: string, sessionId: string) => {
      setHistoryVisualization("messages");
      clearTurnViewState();
      handleRevealInProject(messageId, sourceId, sessionId);
    },
    [clearTurnViewState, handleRevealInProject, setHistoryVisualization],
  );

  const handleRevealInBookmarksWithTurnExit = useCallback(
    (messageId: string, sourceId: string) => {
      clearTurnViewState();
      handleRevealInBookmarks(messageId, sourceId);
    },
    [clearTurnViewState, handleRevealInBookmarks],
  );

  const handleToggleProjectExpansion = useCallback(
    (projectId: string) => {
      const collapsingSelectedSessionProject =
        expandedProjectIds.includes(projectId) &&
        uiHistoryMode === "session" &&
        uiSelectedProjectId === projectId &&
        uiSelectedSessionId.length > 0;

      if (collapsingSelectedSessionProject) {
        selectProjectAllMessages(projectId, { commitMode: "immediate" });
      }

      toggleTreeProjectExpansion(projectId);
    },
    [
      expandedProjectIds,
      selectProjectAllMessages,
      toggleTreeProjectExpansion,
      uiHistoryMode,
      uiSelectedProjectId,
      uiSelectedSessionId,
    ],
  );

  const handleSelectBookmarksVisualization = useCallback(() => {
    if (!currentUiHistorySelection.projectId) {
      return;
    }
    setHistoryVisualization("bookmarks");
    setHistorySelectionImmediate(
      createHistorySelection("bookmarks", currentUiHistorySelection.projectId, uiSelectedSessionId),
    );
  }, [
    currentUiHistorySelection.projectId,
    setHistorySelectionImmediate,
    setHistoryVisualization,
    uiSelectedSessionId,
  ]);

  const handleToggleBookmarksView = useCallback(() => {
    if (historyMode === "bookmarks" && historyDetailMode !== "turn") {
      handleSelectMessagesView();
      return;
    }
    handleSelectBookmarksVisualization();
  }, [
    handleSelectBookmarksVisualization,
    handleSelectMessagesView,
    historyDetailMode,
    historyMode,
  ]);

  const handleCycleHistoryVisualization = useCallback(async () => {
    if (historyVisualization === "messages") {
      if (canToggleTurnView) {
        await handleSelectTurnsView();
        return;
      }
      handleSelectBookmarksVisualization();
      return;
    }
    if (historyVisualization === "turns") {
      handleSelectBookmarksVisualization();
      return;
    }
    handleSelectMessagesView();
  }, [
    canToggleTurnView,
    handleSelectBookmarksVisualization,
    handleSelectMessagesView,
    handleSelectTurnsView,
    historyVisualization,
  ]);

  const resetVisibleHistoryFilters = useCallback(() => {
    if (historyDetailMode === "turn") {
      setTurnQueryInput("");
      return;
    }
    if (historyMode === "bookmarks") {
      setBookmarkQueryInput("");
      return;
    }
    setSessionQueryInput("");
    setSessionPage(0);
  }, [historyDetailMode, historyMode, setTurnQueryInput]);

  const handleSecondaryMessagePaneEscape = useCallback(() => {
    const activeQuery =
      historyDetailMode === "turn"
        ? turnQueryInput.trim()
        : historyMode === "bookmarks"
          ? bookmarkQueryInput.trim()
          : sessionQueryInput.trim();
    if (activeQuery.length > 0) {
      resetVisibleHistoryFilters();
      return true;
    }
    return false;
  }, [
    bookmarkQueryInput,
    historyDetailMode,
    historyMode,
    resetVisibleHistoryFilters,
    sessionQueryInput,
    turnQueryInput,
  ]);

  const handleToggleHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      if (historyDetailMode !== "turn") {
        handleToggleHistoryCategoryShortcutFlat(category);
        return;
      }
      turnViewCategorySoloRestoreRef.current = null;
      setTurnViewCategories((current) => {
        const exists = current.includes(category);
        const next = exists ? current.filter((item) => item !== category) : [...current, category];
        turnViewCategoriesRef.current = next;
        return next;
      });
    },
    [
      handleToggleHistoryCategoryShortcutFlat,
      historyDetailMode,
      setTurnViewCategories,
      turnViewCategorySoloRestoreRef,
      turnViewCategoriesRef,
    ],
  );

  const handleSoloHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      if (historyDetailMode !== "turn") {
        handleSoloHistoryCategoryShortcutFlat(category);
        return;
      }

      const currentCategories = turnViewCategoriesRef.current;
      const restoreState = turnViewCategorySoloRestoreRef.current;
      const isCurrentSoloState =
        currentCategories.length === 1 && currentCategories[0] === category;
      const restoreCategories =
        restoreState?.mode === `solo:${category}` ? restoreState.categories : null;
      const hasUsefulRestore =
        Array.isArray(restoreCategories) &&
        (restoreCategories.length !== currentCategories.length ||
          restoreCategories.some((item, index) => item !== currentCategories[index]));

      const nextCategories = isCurrentSoloState
        ? hasUsefulRestore
          ? [...restoreCategories]
          : [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES]
        : [category];

      turnViewCategorySoloRestoreRef.current = isCurrentSoloState
        ? null
        : {
            mode: `solo:${category}`,
            categories: [...currentCategories],
          };
      turnViewCategoriesRef.current = nextCategories;
      setTurnViewCategories(nextCategories);
    },
    [
      handleSoloHistoryCategoryShortcutFlat,
      historyDetailMode,
      setTurnViewCategories,
      turnViewCategoriesRef,
      turnViewCategorySoloRestoreRef,
    ],
  );

  const handleTogglePrimaryHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleTogglePrimaryHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const targetCategories = new Set(TURN_PRIMARY_HISTORY_CATEGORIES);
    const hasAllPrimary = TURN_PRIMARY_HISTORY_CATEGORIES.every((category) =>
      currentCategories.includes(category),
    );
    const nextCategories = hasAllPrimary
      ? currentCategories.filter((category) => !targetCategories.has(category))
      : [
          ...currentCategories.filter((category) => !targetCategories.has(category)),
          ...TURN_PRIMARY_HISTORY_CATEGORIES,
        ];
    turnViewCategorySoloRestoreRef.current = null;
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [
    handleTogglePrimaryHistoryCategoriesShortcutFlat,
    historyDetailMode,
    setTurnViewCategories,
    turnViewCategoriesRef,
    turnViewCategorySoloRestoreRef,
  ]);

  const handleToggleAllHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleToggleAllHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const nextCategories =
      currentCategories.length === CATEGORIES.length &&
      currentCategories.every((category, index) => category === CATEGORIES[index])
        ? []
        : [...CATEGORIES];
    turnViewCategorySoloRestoreRef.current = null;
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [
    handleToggleAllHistoryCategoriesShortcutFlat,
    historyDetailMode,
    setTurnViewCategories,
    turnViewCategoriesRef,
    turnViewCategorySoloRestoreRef,
  ]);

  const handleFocusPrimaryHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleFocusPrimaryHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const restoreState = turnViewCategorySoloRestoreRef.current;
    const primaryCategories = [...TURN_PRIMARY_HISTORY_CATEGORIES];
    const isCurrentPreset =
      currentCategories.length === primaryCategories.length &&
      currentCategories.every((category, index) => category === primaryCategories[index]);
    const restoreCategories =
      restoreState?.mode === "preset:primary" ? restoreState.categories : null;
    const hasUsefulRestore =
      Array.isArray(restoreCategories) &&
      (restoreCategories.length !== currentCategories.length ||
        restoreCategories.some((item, index) => item !== currentCategories[index]));
    const nextCategories = isCurrentPreset
      ? hasUsefulRestore
        ? [...restoreCategories]
        : [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES]
      : primaryCategories;
    turnViewCategorySoloRestoreRef.current = isCurrentPreset
      ? null
      : {
          mode: "preset:primary",
          categories: [...currentCategories],
        };
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [
    handleFocusPrimaryHistoryCategoriesShortcutFlat,
    historyDetailMode,
    setTurnViewCategories,
    turnViewCategoriesRef,
    turnViewCategorySoloRestoreRef,
  ]);

  const handleFocusAllHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleFocusAllHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const restoreState = turnViewCategorySoloRestoreRef.current;
    const isCurrentPreset =
      currentCategories.length === CATEGORIES.length &&
      currentCategories.every((category, index) => category === CATEGORIES[index]);
    const restoreCategories = restoreState?.mode === "preset:all" ? restoreState.categories : null;
    const hasUsefulRestore =
      Array.isArray(restoreCategories) &&
      (restoreCategories.length !== currentCategories.length ||
        restoreCategories.some((item, index) => item !== currentCategories[index]));
    const nextCategories = isCurrentPreset
      ? hasUsefulRestore
        ? [...restoreCategories]
        : [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES]
      : [...CATEGORIES];
    turnViewCategorySoloRestoreRef.current = isCurrentPreset
      ? null
      : {
          mode: "preset:all",
          categories: [...currentCategories],
        };
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [
    handleFocusAllHistoryCategoriesShortcutFlat,
    historyDetailMode,
    setTurnViewCategories,
    turnViewCategoriesRef,
    turnViewCategorySoloRestoreRef,
  ]);

  const handleToggleCategoryDefaultExpansion = useCallback(
    (category: MessageCategory) => {
      if (historyDetailMode !== "turn") {
        handleToggleCategoryDefaultExpansionFlat(category);
        return;
      }

      setTurnViewExpandedByDefaultCategories((current) =>
        current.includes(category)
          ? current.filter((item) => item !== category)
          : [...current, category],
      );
      setMessageExpansionOverrides((current) => {
        const next = { ...current };
        for (const message of turnVisibleMessages) {
          if (message.category !== category || !(message.id in next)) {
            continue;
          }
          delete next[message.id];
        }
        return next;
      });
    },
    [
      handleToggleCategoryDefaultExpansionFlat,
      historyDetailMode,
      setTurnViewExpandedByDefaultCategories,
      turnVisibleMessages,
    ],
  );
  const isTurnExpandedByDefault = useCallback(
    (category: MessageCategory) => turnViewExpandedByDefaultCategories.includes(category),
    [turnViewExpandedByDefaultCategories],
  );
  const effectiveTurnCombinedChangesExpanded =
    turnViewCombinedChangesExpandedOverride ?? turnViewCombinedChangesExpanded;

  const handleToggleVisibleCategoryMessagesExpandedInTurn = useCallback(
    (category: MessageCategory) => {
      const categoryMessages = turnVisibleMessages.filter(
        (message) => message.category === category,
      );
      if (categoryMessages.length === 0) {
        return;
      }
      setMessageExpansionOverrides((current) => {
        const expanded = !categoryMessages.every(
          (message) => current[message.id] ?? isTurnExpandedByDefault(message.category),
        );
        const next = { ...current };
        for (const message of categoryMessages) {
          if (expanded === isTurnExpandedByDefault(message.category)) {
            delete next[message.id];
          } else {
            next[message.id] = expanded;
          }
        }
        return next;
      });
    },
    [isTurnExpandedByDefault, turnVisibleMessages],
  );

  const handleToggleMessageExpandedInTurn = useCallback(
    (messageId: string, category: MessageCategory) => {
      setMessageExpansionOverrides((current) => {
        const nextExpanded = !(current[messageId] ?? isTurnExpandedByDefault(category));
        const next = { ...current };
        if (nextExpanded === isTurnExpandedByDefault(category)) {
          delete next[messageId];
        } else {
          next[messageId] = nextExpanded;
        }
        return next;
      });
    },
    [isTurnExpandedByDefault],
  );

  const visibleExpansionItems = useMemo(
    () => [
      ...detailMessages.map((message) => {
        const defaultExpanded =
          historyDetailMode === "turn"
            ? turnViewExpandedByDefaultCategories.includes(message.category)
            : isExpandedByDefault(message.category);
        const currentExpanded = messageExpansionOverrides[message.id] ?? defaultExpanded;
        const atDefault = !(message.id in messageExpansionOverrides);
        return {
          id: message.id,
          currentExpanded,
          defaultExpanded,
          atDefault,
        };
      }),
      ...(historyDetailMode === "turn"
        ? [
            {
              id: "__combined_changes__",
              currentExpanded: effectiveTurnCombinedChangesExpanded,
              defaultExpanded: turnViewCombinedChangesExpanded,
              atDefault: turnViewCombinedChangesExpandedOverride === null,
            },
          ]
        : []),
    ],
    [
      detailMessages,
      effectiveTurnCombinedChangesExpanded,
      historyDetailMode,
      isExpandedByDefault,
      messageExpansionOverrides,
      turnViewCombinedChangesExpanded,
      turnViewCombinedChangesExpandedOverride,
      turnViewExpandedByDefaultCategories,
    ],
  );
  const visibleExpansionScopeKey = useMemo(
    () =>
      historyDetailMode === "turn"
        ? [
            "turn",
            historyVisualization,
            currentTurnScopeKey,
            sessionTurnDetail?.anchorMessageId ?? "",
            turnViewSortDirection,
            effectiveTurnQuery,
            turnViewCategories.join(","),
            turnViewExpandedByDefaultCategories.join(","),
            turnViewCombinedChangesExpanded ? "1" : "0",
          ].join("\u0000")
        : [
            "flat",
            historyVisualization,
            historyMode,
            selectedProjectId,
            selectedSessionId,
            loadedHistoryPage,
            activeMessageSortDirection,
            historyCategories.join(","),
            expandedByDefaultCategories.join(","),
            historyMode === "bookmarks" ? effectiveBookmarkQuery : effectiveSessionQuery,
          ].join("\u0000"),
    [
      activeMessageSortDirection,
      currentTurnScopeKey,
      effectiveBookmarkQuery,
      effectiveSessionQuery,
      effectiveTurnQuery,
      expandedByDefaultCategories,
      historyDetailMode,
      historyMode,
      historyVisualization,
      historyCategories,
      loadedHistoryPage,
      selectedProjectId,
      selectedSessionId,
      sessionTurnDetail?.anchorMessageId,
      turnViewCategories,
      turnViewCombinedChangesExpanded,
      turnViewExpandedByDefaultCategories,
      turnViewSortDirection,
    ],
  );

  useEffect(() => {
    const scopeChanged = visibleExpansionScopeKeyRef.current !== visibleExpansionScopeKey;
    const becamePopulated =
      visibleExpansionItemCountRef.current === 0 && visibleExpansionItems.length > 0;
    visibleExpansionItemCountRef.current = visibleExpansionItems.length;
    if (!scopeChanged && !becamePopulated) {
      return;
    }
    visibleExpansionScopeKeyRef.current = visibleExpansionScopeKey;
    setVisibleExpansionActionState(deriveVisibleExpansionAction(visibleExpansionItems));
  }, [visibleExpansionItems, visibleExpansionScopeKey]);

  useEffect(() => {
    if (combinedChangesDiffScopeKeyRef.current === visibleExpansionScopeKey) {
      return;
    }
    combinedChangesDiffScopeKeyRef.current = visibleExpansionScopeKey;
    setCombinedChangesDiffState({ hasVisibleDiffs: false, allExpanded: false });
    setCombinedChangesDiffExpansionRequest(null);
  }, [visibleExpansionScopeKey]);

  const handleToggleAllCategoryDefaultExpansion = useCallback(() => {
    if (visibleExpansionItems.length === 0) {
      return;
    }
    const action = visibleExpansionActionState;
    if (action === "restore") {
      setMessageExpansionOverrides((current) => {
        const next = { ...current };
        let changed = false;
        for (const item of visibleExpansionItems) {
          if (item.id === "__combined_changes__") {
            continue;
          }
          if (!(item.id in next)) {
            continue;
          }
          delete next[item.id];
          changed = true;
        }
        return changed ? next : current;
      });
      if (historyDetailMode === "turn") {
        setTurnViewCombinedChangesExpandedOverride(null);
      }
      setVisibleExpansionActionState(getNextVisibleExpansionAction(action));
      return;
    }

    const expanded = action === "expand";
    setMessageExpansionOverrides((current) => {
      const next = { ...current };
      let changed = false;
      for (const item of visibleExpansionItems) {
        if (item.id === "__combined_changes__") {
          continue;
        }
        if (expanded === item.defaultExpanded) {
          if (item.id in next) {
            delete next[item.id];
            changed = true;
          }
          continue;
        }
        if (next[item.id] !== expanded) {
          next[item.id] = expanded;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    if (historyDetailMode === "turn") {
      setTurnViewCombinedChangesExpandedOverride(
        expanded === turnViewCombinedChangesExpanded ? null : expanded,
      );
    }
    setVisibleExpansionActionState(getNextVisibleExpansionAction(action));
  }, [
    historyDetailMode,
    turnViewCombinedChangesExpanded,
    visibleExpansionActionState,
    visibleExpansionItems,
  ]);

  const hasTurnCombinedDiffTarget = useMemo(
    () =>
      historyDetailMode === "turn" &&
      turnHasCombinedVisibleDiffs(
        (sessionTurnDetail?.messages ?? []) as Parameters<typeof turnHasCombinedVisibleDiffs>[0],
      ),
    [historyDetailMode, sessionTurnDetail?.messages],
  );

  const handleCombinedChangesDiffStateChange = useCallback(
    (state: { hasVisibleDiffs: boolean; allExpanded: boolean }) => {
      setCombinedChangesDiffState((current) =>
        current.hasVisibleDiffs === state.hasVisibleDiffs &&
        current.allExpanded === state.allExpanded
          ? current
          : state,
      );
    },
    [],
  );

  const handleToggleCombinedChangesDiffsExpanded = useCallback(() => {
    if (!hasTurnCombinedDiffTarget) {
      return;
    }
    const nextExpanded = !combinedChangesDiffState.allExpanded;
    setCombinedChangesDiffExpansionRequest((current) => ({
      expanded: nextExpanded,
      version: (current?.version ?? 0) + 1,
    }));
  }, [combinedChangesDiffState.allExpanded, hasTurnCombinedDiffTarget]);

  const areAllMessagesExpanded =
    visibleExpansionItems.length > 0 && visibleExpansionItems.every((item) => item.currentExpanded);
  const globalExpandCollapseLabel =
    visibleExpansionActionState === "collapse"
      ? "Collapse"
      : visibleExpansionActionState === "restore"
        ? "Restore"
        : "Expand";
  const globalExpandCollapseIconName: "collapseAll" | "zoomReset" | "expandAll" =
    visibleExpansionActionState === "collapse"
      ? "collapseAll"
      : visibleExpansionActionState === "restore"
        ? "zoomReset"
        : "expandAll";
  const effectiveHistoryPage = historyDetailMode === "turn" ? turnDisplayPage : sessionPage;
  const effectiveTotalPages = historyDetailMode === "turn" ? turnTotalPages : totalPages;
  const effectiveCanNavigatePages =
    historyDetailMode === "turn" ? turnTotalPages > 1 : canNavigatePages;
  const effectiveCanGoToPreviousHistoryPage =
    historyDetailMode === "turn"
      ? turnViewSortDirection === "desc"
        ? Boolean(sessionTurnDetail?.nextTurnAnchorMessageId)
        : Boolean(sessionTurnDetail?.previousTurnAnchorMessageId)
      : canGoToPreviousHistoryPage;
  const effectiveCanGoToNextHistoryPage =
    historyDetailMode === "turn"
      ? turnViewSortDirection === "desc"
        ? Boolean(sessionTurnDetail?.previousTurnAnchorMessageId)
        : Boolean(sessionTurnDetail?.nextTurnAnchorMessageId)
      : canGoToNextHistoryPage;

  const goToPreviousHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToPreviousTurn();
      return;
    }
    goToPreviousHistoryPage();
  }, [goToPreviousHistoryPage, goToPreviousTurn, historyDetailMode]);

  const goToNextHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToNextTurn();
      return;
    }
    goToNextHistoryPage();
  }, [goToNextHistoryPage, goToNextTurn, historyDetailMode]);

  const goToFirstHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToFirstTurn();
      return;
    }
    goToFirstHistoryPage();
  }, [goToFirstHistoryPage, goToFirstTurn, historyDetailMode]);

  const goToLastHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToLatestTurn();
      return;
    }
    goToLastHistoryPage();
  }, [goToLastHistoryPage, goToLatestTurn, historyDetailMode]);

  const goToHistoryPageEffective = useCallback(
    (page: number) => {
      return goToTurnNumber(page, goToHistoryPage);
    },
    [goToHistoryPage, goToTurnNumber],
  );

  const refreshSelection = useMemo(
    () => ({
      historyMode,
      historyDetailMode,
      effectiveHistoryPage,
      selectedProjectId,
      selectedSessionId,
      turnSourceSessionId,
      turnAnchorMessageId,
      turnVisualizationSelection,
      canToggleTurnView,
      projectViewMode,
    }),
    [
      canToggleTurnView,
      effectiveHistoryPage,
      historyDetailMode,
      historyMode,
      projectViewMode,
      selectedProjectId,
      selectedSessionId,
      turnAnchorMessageId,
      turnSourceSessionId,
      turnVisualizationSelection,
    ],
  );

  const refreshDetailState = useMemo(
    () => ({
      detailMessages,
      selectedProject,
      selectedSession,
      sessionDetail,
      projectCombinedDetail,
      bookmarksResponse,
      sessionTurnDetail,
    }),
    [
      bookmarksResponse,
      detailMessages,
      projectCombinedDetail,
      selectedProject,
      selectedSession,
      sessionDetail,
      sessionTurnDetail,
    ],
  );

  const refreshSortState = useMemo(
    () => ({
      messagePageSize: appearance.messagePageSize,
      messageSortDirection,
      bookmarkSortDirection,
      projectAllSortDirection,
      turnViewSortDirection,
      activeMessageSortDirection,
    }),
    [
      activeMessageSortDirection,
      appearance.messagePageSize,
      bookmarkSortDirection,
      messageSortDirection,
      projectAllSortDirection,
      turnViewSortDirection,
    ],
  );

  const refreshCatalog = useMemo(
    () => ({
      initialAutoRefreshStrategy: initialPaneState?.currentAutoRefreshStrategy ?? "off",
      loadProjects,
      loadSessions,
      refreshTreeProjectSessions,
      treeProjectSessionsByProjectIdRef,
    }),
    [
      initialPaneState?.currentAutoRefreshStrategy,
      loadProjects,
      loadSessions,
      refreshTreeProjectSessions,
      treeProjectSessionsByProjectIdRef,
    ],
  );

  const refreshDetailApi = useMemo(
    () => ({
      loadBookmarks,
      requestSessionDetailRefresh,
      requestProjectCombinedDetailRefresh,
      requestTurnDetailRefresh,
    }),
    [
      loadBookmarks,
      requestProjectCombinedDetailRefresh,
      requestSessionDetailRefresh,
      requestTurnDetailRefresh,
    ],
  );

  const refreshViewport = useMemo(
    () => ({
      messageListRef,
      historyDetailMode,
      turnAnchorMessageId,
      setSessionScrollTop,
      sessionScrollTopRef,
      pendingRestoredSessionScrollRef,
      focusMessageId,
      visibleFocusedMessageId,
      focusedMessagePosition,
      focusedMessageRef,
      pendingMessageAreaFocus,
      setPendingMessageAreaFocus,
      pendingMessagePageNavigation,
      loadedHistoryPage,
      setPendingMessagePageNavigation,
      setFocusMessageId,
    }),
    [
      focusMessageId,
      focusedMessagePosition,
      historyDetailMode,
      loadedHistoryPage,
      pendingMessageAreaFocus,
      pendingMessagePageNavigation,
      setSessionScrollTop,
      turnAnchorMessageId,
      visibleFocusedMessageId,
    ],
  );

  const { handleRefreshAllData } = useHistoryRefreshController({
    refreshContextRef,
    selection: refreshSelection,
    detailState: refreshDetailState,
    sortState: refreshSortState,
    catalog: refreshCatalog,
    detailApi: refreshDetailApi,
    viewport: refreshViewport,
  });

  const pageHistoryMessages = useCallback(
    (direction: "up" | "down", { preserveFocus = false }: { preserveFocus?: boolean } = {}) => {
      const container = messageListRef.current;
      if (!container) {
        return;
      }

      const styles = window.getComputedStyle(container);
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const visibleContentHeight = container.clientHeight - paddingTop - paddingBottom;
      const pageSize = Math.max(0, visibleContentHeight - MESSAGE_PAGE_SCROLL_OVERLAP_PX);
      if (pageSize <= 0) {
        return;
      }

      const delta = direction === "down" ? pageSize : -pageSize;
      const nextScrollTop = Math.max(0, container.scrollTop + delta);
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: nextScrollTop });
      } else {
        container.scrollTop = nextScrollTop;
      }
      if (!preserveFocus) {
        container.focus({ preventScroll: true });
      }
    },
    [],
  );

  const { historyExportState, handleExportMessages } = useHistoryExportController({
    codetrail,
    logError,
    historyDetailMode,
    historyMode,
    selectedProjectId,
    selectedSessionId,
    loadedHistoryPage,
    messagePageSize: appearance.messagePageSize,
    historyCategories,
    effectiveBookmarkQuery,
    effectiveSessionQuery,
    searchMode,
    activeMessageSortDirection,
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
    historyDetailMode,
    historyVisualization,
    selectedProjectId,
    selectedSessionId,
    uiHistoryMode,
    uiSelectedProjectId,
    uiSelectedSessionId,
    consumeProjectPaneFocusSelectionBehavior,
    paneStateHydrated,
    sortedProjects,
    projectUpdates,
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder,
    handleToggleAllFolders,
    handleToggleProjectExpansion,
    sortedSessions,
    treeProjectSessionsByProjectId: sortedTreeProjectSessionsByProjectId,
    treeProjectSessionsLoadingByProjectId,
    selectedProject,
    selectedSession,
    enabledProviders,
    removeMissingSessionsDuringIncrementalIndexing,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    projectProviders,
    setProjectProviders,
    projectQueryInput,
    setProjectQueryInput,
    projectProviderCounts,
    projectViewMode,
    setProjectViewMode,
    projectSortField,
    setProjectSortField,
    projectSortDirection,
    setProjectSortDirection,
    projectListUpdateSource,
    sessionSortDirection,
    setSessionSortDirection,
    messageSortDirection,
    setMessageSortDirection,
    bookmarkSortDirection,
    setBookmarkSortDirection,
    projectAllSortDirection,
    setProjectAllSortDirection,
    turnViewSortDirection,
    setTurnViewSortDirection,
    historyCategories,
    setHistoryCategories,
    expandedByDefaultCategories,
    setExpandedByDefaultCategories,
    turnViewCategories,
    setTurnViewCategories,
    turnViewExpandedByDefaultCategories,
    setTurnViewExpandedByDefaultCategories,
    turnViewCombinedChangesExpanded,
    setTurnViewCombinedChangesExpanded,
    setTurnViewCombinedChangesExpandedOverride,
    effectiveTurnCombinedChangesExpanded,
    combinedChangesDiffExpansionRequest,
    handleCombinedChangesDiffStateChange,
    collapseMultiFileToolDiffs: appearance.collapseMultiFileToolDiffs,
    setCollapseMultiFileToolDiffs: appearance.setCollapseMultiFileToolDiffs,
    liveWatchEnabled,
    setLiveWatchEnabled,
    liveWatchRowHasBackground,
    setLiveWatchRowHasBackground,
    claudeHooksPrompted,
    setClaudeHooksPrompted,
    systemMessageRegexRules,
    setSystemMessageRegexRules,
    preferredAutoRefreshStrategy,
    setPreferredAutoRefreshStrategy,
    projectPaneCollapsed,
    setProjectPaneCollapsed,
    sessionPaneCollapsed,
    setSessionPaneCollapsed,
    singleClickFoldersExpand,
    setSingleClickFoldersExpand,
    singleClickProjectsExpand,
    setSingleClickProjectsExpand,
    hideSessionsPaneInTreeView,
    setHideSessionsPaneInTreeView,
    hideSessionsPaneForTreeView,
    beginResize,
    workspaceStyle,
    sessionPaneNavigationItems,
    visibleSessionPaneSessions,
    visibleSessionPaneBookmarksCount,
    visibleSessionPaneAllSessionsCount,
    currentViewBookmarkCount,
    allSessionsCount,
    sessionDetail,
    sessionTurnDetail,
    turnAnchorMessage,
    turnVisibleMessages,
    turnCategoryCounts,
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
    sessionPage: effectiveHistoryPage,
    messagePageSize: appearance.messagePageSize,
    setMessagePageSize: appearance.setMessagePageSize,
    loadedHistoryPage,
    setSessionPage,
    sessionQueryInput,
    setSessionQueryInput,
    bookmarkQueryInput,
    setBookmarkQueryInput,
    turnQueryInput,
    setTurnQueryInput,
    effectiveSessionQuery,
    effectiveBookmarkQuery,
    effectiveTurnQuery,
    totalPages: effectiveTotalPages,
    canNavigatePages: effectiveCanNavigatePages,
    canGoToPreviousHistoryPage: effectiveCanGoToPreviousHistoryPage,
    canGoToNextHistoryPage: effectiveCanGoToNextHistoryPage,
    activeMessageSortDirection,
    messageSortTooltip,
    areAllMessagesExpanded,
    globalExpandCollapseLabel,
    globalExpandCollapseIconName,
    messageExpansionOverrides,
    messagePathRoots,
    isExpandedByDefault,
    handleToggleHistoryCategoryShortcut,
    handleSoloHistoryCategoryShortcut,
    handleTogglePrimaryHistoryCategoriesShortcut,
    handleToggleAllHistoryCategoriesShortcut,
    handleFocusPrimaryHistoryCategoriesShortcut,
    handleFocusAllHistoryCategoriesShortcut,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleVisibleCategoryMessagesExpandedInTurn,
    handleToggleCategoryDefaultExpansion,
    handleToggleAllCategoryDefaultExpansion,
    handleToggleCombinedChangesDiffsExpanded,
    handleToggleMessageExpanded,
    handleToggleMessageExpandedInTurn,
    handleToggleBookmark,
    handleRevealInSession,
    handleRevealInProject,
    handleRevealInBookmarks,
    handleRevealInSessionWithTurnExit,
    handleRevealInProjectWithTurnExit,
    handleRevealInBookmarksWithTurnExit,
    handleRevealInTurn,
    handleSelectMessagesView,
    handleSelectTurnsView,
    handleSelectBookmarksVisualization,
    handleCycleHistoryVisualization,
    handleToggleBookmarksView,
    handleToggleTurnView,
    handleSecondaryMessagePaneEscape,
    canToggleTurnView,
    handleMessageListScroll,
    handleHistorySearchKeyDown,
    handleCopySessionDetails,
    handleCopyProjectDetails,
    focusSessionSearch,
    focusAdjacentHistoryMessage,
    pageHistoryMessagesUp: (options?: { preserveFocus?: boolean }) =>
      pageHistoryMessages("up", options),
    pageHistoryMessagesDown: (options?: { preserveFocus?: boolean }) =>
      pageHistoryMessages("down", options),
    handleExportMessages,
    historyExportState,
    selectProjectAllMessages,
    selectBookmarksView,
    openProjectBookmarksView,
    closeBookmarksView,
    selectSessionView,
    queueProjectTreeNoopCommit,
    ensureTreeProjectSessionsLoaded,
    selectAdjacentSession,
    selectAdjacentProject,
    handleProjectTreeArrow,
    handleProjectTreeEnter,
    goToHistoryPage: goToHistoryPageEffective,
    goToFirstHistoryPage: goToFirstHistoryPageEffective,
    goToLastHistoryPage: goToLastHistoryPageEffective,
    goToPreviousHistoryPage: goToPreviousHistoryPageEffective,
    goToNextHistoryPage: goToNextHistoryPageEffective,
    handleRefresh,
    navigateFromSearchResult,
    setPendingSearchNavigation,
    pendingSearchNavigation,
    selectedSummaryMessageCount,
    historyCategoryExpandShortcutMap,
    historyCategoriesShortcutMap,
    historyCategorySoloShortcutMap,
    prettyCategory,
    prettyProvider: formatPrettyProvider,
    formatDate,
    handleRefreshAllData,
  };
}
