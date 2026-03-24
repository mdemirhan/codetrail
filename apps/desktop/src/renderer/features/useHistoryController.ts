import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type {
  MessageCategory,
  Provider,
  SearchMode,
  SystemMessageRegexRules,
} from "@codetrail/core/browser";

import type { HistoryExportPhase, HistoryExportProgressPayload } from "../../shared/historyExport";
import {
  DEFAULT_PREFERRED_REFRESH_STRATEGY,
  type NonOffRefreshStrategy,
  isWatchRefreshStrategy,
} from "../app/autoRefresh";
import {
  DEFAULT_MESSAGE_CATEGORIES,
  EMPTY_BOOKMARKS_RESPONSE,
  EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
} from "../app/constants";
import {
  createHistorySelection,
  setHistorySelectionProjectId,
  setHistorySelectionSessionId,
} from "../app/historySelection";
import type {
  BookmarkListResponse,
  HistoryExportScope,
  HistorySearchNavigation,
  HistorySelection,
  HistorySelectionCommitMode,
  PaneStateSnapshot,
  PendingMessagePageNavigation,
  PendingRevealTarget,
  ProjectCombinedDetail,
  ProjectSortField,
  ProjectSummary,
  ProjectViewMode,
  SessionDetail,
  SessionSummary,
  SortDirection,
  TreeAutoRevealSessionRequest,
} from "../app/types";
import { useProjectPaneTreeState } from "../components/history/useProjectPaneTreeState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePaneStateSync } from "../hooks/usePaneStateSync";
import { useReconcileProviderSelection } from "../hooks/useReconcileProviderSelection";
import { useResizablePanes } from "../hooks/useResizablePanes";
import { useCodetrailClient } from "../lib/codetrailClient";
import { mergeStableProjectOrder, resolveProjectRefreshSource } from "../lib/projectUpdates";
import { clamp, compareRecent, sessionActivityOf } from "../lib/viewUtils";
import {
  type AppearanceState,
  focusHistoryList,
  getMessageListFingerprint,
} from "./historyControllerShared";
import {
  getHistoryRefreshScopeKey,
  getProjectRefreshFingerprint,
  getRefreshBaselineTotalCount,
  getSessionRefreshFingerprint,
  isLiveEdgePage,
  isPinnedToVisualRefreshEdge,
} from "./historyRefreshPolicy";
import { useHistoryDataEffects } from "./useHistoryDataEffects";
import { useHistoryDerivedState } from "./useHistoryDerivedState";
import { useHistoryInteractions } from "./useHistoryInteractions";
import { useHistorySelectionState } from "./useHistorySelectionState";
import { useHistoryViewportEffects } from "./useHistoryViewportEffects";
export { setTestHistorySelectionDebounceOverrides } from "./useHistorySelectionState";

export type RefreshContext = {
  refreshId: number;
  originPage: number;
  scopeKey: string;
  baselineTotalCount: number;
  followEligible: boolean;
  scrollPreservation: {
    scrollTop: number;
    referenceMessageId: string;
    referenceOffsetTop: number;
  } | null;
  prevMessageIds: string;
};

export type HistoryExportState = {
  open: boolean;
  exportId: string | null;
  scope: HistoryExportScope;
  percent: number;
  phase: HistoryExportPhase;
  message: string;
};

function clearAutoRevealSessionRequest(
  setAutoRevealSessionRequest: Dispatch<SetStateAction<TreeAutoRevealSessionRequest | null>>,
) {
  setAutoRevealSessionRequest(null);
}

type ProjectUpdateState = {
  messageDelta: number;
  updatedAt: number;
};

const MESSAGE_PAGE_SCROLL_OVERLAP_PX = 20;
const PROJECT_UPDATE_HIGHLIGHT_MS = 8_000;
const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function getProjectSortLabel(project: ProjectSummary): string {
  return project.name.trim() || project.path.trim() || project.id;
}

function compareProjectName(left: ProjectSummary, right: ProjectSummary): number {
  return PROJECT_NAME_COLLATOR.compare(getProjectSortLabel(left), getProjectSortLabel(right));
}

function compareProjectsByField(
  left: ProjectSummary,
  right: ProjectSummary,
  sortField: ProjectSortField,
): number {
  if (sortField === "name") {
    return (
      compareProjectName(left, right) ||
      compareRecent(left.lastActivity, right.lastActivity) ||
      left.id.localeCompare(right.id)
    );
  }

  return (
    compareRecent(left.lastActivity, right.lastActivity) ||
    compareProjectName(left, right) ||
    left.id.localeCompare(right.id)
  );
}

function sortSessionSummaries(
  sessions: SessionSummary[],
  sortDirection: SortDirection,
): SessionSummary[] {
  const next = [...sessions];
  next.sort((left, right) => {
    const byRecent =
      compareRecent(sessionActivityOf(left), sessionActivityOf(right)) ||
      left.messageCount - right.messageCount ||
      left.id.localeCompare(right.id);
    return sortDirection === "asc" ? byRecent : -byRecent;
  });
  return next;
}

function getVisibleMessageAnchor(container: HTMLElement): {
  referenceMessageId: string;
  referenceOffsetTop: number;
} | null {
  const rect = container.getBoundingClientRect();
  const probeX = rect.left + Math.min(24, Math.max(1, rect.width / 2));
  const probeY = rect.top + Math.min(24, Math.max(1, rect.height / 4));
  const elementAtPoint =
    typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(probeX, probeY)
      : null;
  const anchor =
    elementAtPoint instanceof HTMLElement
      ? elementAtPoint.closest<HTMLElement>("[data-history-message-id]")
      : null;
  if (anchor && container.contains(anchor)) {
    return {
      referenceMessageId: anchor.getAttribute("data-history-message-id") ?? "",
      referenceOffsetTop: anchor.offsetTop,
    };
  }

  const firstMessage = container.querySelector<HTMLElement>("[data-history-message-id]");
  if (!firstMessage) {
    return null;
  }
  return {
    referenceMessageId: firstMessage.getAttribute("data-history-message-id") ?? "",
    referenceOffsetTop: firstMessage.offsetTop,
  };
}

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
}) {
  const codetrail = useCodetrailClient();
  const initialProjectPaneWidth = clamp(initialPaneState?.projectPaneWidth ?? 300, 230, 520);
  const initialSessionPaneWidth = clamp(initialPaneState?.sessionPaneWidth ?? 320, 250, 620);
  const initialSessionScrollTop = initialPaneState?.sessionScrollTop ?? 0;

  const [projectQueryInput, setProjectQueryInput] = useState("");
  const [
    removeMissingSessionsDuringIncrementalIndexing,
    setRemoveMissingSessionsDuringIncrementalIndexing,
  ] = useState(initialPaneState?.removeMissingSessionsDuringIncrementalIndexing ?? false);
  const [projectProviders, setProjectProviders] = useState<Provider[]>(
    (initialPaneState?.projectProviders ?? enabledProviders).filter((provider) =>
      enabledProviders.includes(provider),
    ),
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectListUpdateSource, setProjectListUpdateSource] = useState<"auto" | "resort">(
    "resort",
  );
  const [projectOrderIds, setProjectOrderIds] = useState<string[]>([]);
  const [projectUpdates, setProjectUpdates] = useState<Record<string, ProjectUpdateState>>({});
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [treeProjectSessionsByProjectId, setTreeProjectSessionsByProjectId] = useState<
    Record<string, SessionSummary[]>
  >({});
  const [treeProjectSessionsLoadingByProjectId, setTreeProjectSessionsLoadingByProjectId] =
    useState<Record<string, boolean>>({});
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
  const [visibleBookmarkedMessageIds, setVisibleBookmarkedMessageIds] = useState<string[]>([]);
  const [bookmarkStatesRefreshNonce, setBookmarkStatesRefreshNonce] = useState(0);
  const [sessionPage, setSessionPage] = useState(initialPaneState?.sessionPage ?? 0);
  const [sessionScrollTop, setSessionScrollTop] = useState(initialSessionScrollTop);
  const [systemMessageRegexRules, setSystemMessageRegexRules] = useState<SystemMessageRegexRules>(
    initialPaneState?.systemMessageRegexRules
      ? { ...EMPTY_SYSTEM_MESSAGE_REGEX_RULES, ...initialPaneState.systemMessageRegexRules }
      : EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  );
  const [projectViewMode, setProjectViewMode] = useState<ProjectViewMode>(
    initialPaneState?.projectViewMode ?? "tree",
  );
  const [projectSortField, setProjectSortField] = useState<ProjectSortField>(
    initialPaneState?.projectSortField ?? "last_active",
  );
  const [projectSortDirection, setProjectSortDirection] = useState<SortDirection>(
    initialPaneState?.projectSortDirection ?? "desc",
  );
  const [sessionSortDirection, setSessionSortDirection] = useState<SortDirection>(
    initialPaneState?.sessionSortDirection ?? "desc",
  );
  const [messageSortDirection, setMessageSortDirection] = useState<SortDirection>(
    initialPaneState?.messageSortDirection ?? "desc",
  );
  const [bookmarkSortDirection, setBookmarkSortDirection] = useState<SortDirection>(
    initialPaneState?.bookmarkSortDirection ?? "desc",
  );
  const [projectAllSortDirection, setProjectAllSortDirection] = useState<SortDirection>(
    initialPaneState?.projectAllSortDirection ?? "desc",
  );
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [bookmarkQueryInput, setBookmarkQueryInput] = useState("");
  const [preferredAutoRefreshStrategy, setPreferredAutoRefreshStrategy] =
    useState<NonOffRefreshStrategy>(
      initialPaneState?.preferredAutoRefreshStrategy ?? DEFAULT_PREFERRED_REFRESH_STRATEGY,
    );
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>(
    initialPaneState?.historyCategories ?? [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const [expandedByDefaultCategories, setExpandedByDefaultCategories] = useState<MessageCategory[]>(
    initialPaneState?.expandedByDefaultCategories ?? [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const [liveWatchEnabled, setLiveWatchEnabled] = useState(
    initialPaneState?.liveWatchEnabled ?? true,
  );
  const [liveWatchRowHasBackground, setLiveWatchRowHasBackground] = useState(
    initialPaneState?.liveWatchRowHasBackground ?? true,
  );
  const [claudeHooksPrompted, setClaudeHooksPrompted] = useState(
    initialPaneState?.claudeHooksPrompted ?? false,
  );
  const [projectPaneCollapsed, setProjectPaneCollapsed] = useState(
    initialPaneState?.projectPaneCollapsed ?? false,
  );
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = useState(
    initialPaneState?.sessionPaneCollapsed ?? true,
  );
  const [singleClickFoldersExpand, setSingleClickFoldersExpand] = useState(
    initialPaneState?.singleClickFoldersExpand ?? true,
  );
  const [singleClickProjectsExpand, setSingleClickProjectsExpand] = useState(
    initialPaneState?.singleClickProjectsExpand ?? false,
  );
  const [hideSessionsPaneInTreeView, setHideSessionsPaneInTreeView] = useState(
    initialPaneState?.hideSessionsPaneInTreeView ?? false,
  );
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
  const [historyExportState, setHistoryExportState] = useState<HistoryExportState>({
    open: false,
    exportId: null,
    scope: "current_page",
    percent: 0,
    phase: "preparing",
    message: "",
  });

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
  const refreshContextRef = useRef<RefreshContext | null>(null);
  const selectedProjectRefreshFingerprintRef = useRef("");
  const selectedSessionRefreshFingerprintRef = useRef("");
  const refreshIdCounterRef = useRef(0);
  const treeProjectSessionsLoadTokenRef = useRef<Record<string, number>>({});
  const treeProjectSessionsByProjectIdRef = useRef<Record<string, SessionSummary[]>>({});
  const treeProjectSessionsLoadingByProjectIdRef = useRef<Record<string, boolean>>({});
  const initialHistoryPaneFocusAppliedRef = useRef(false);
  const projectsRef = useRef<ProjectSummary[]>([]);
  const projectUpdateTimeoutsRef = useRef<Map<string, number>>(new Map());
  const projectOrderControlKeyRef = useRef("");
  const startupWatchResortPendingRef = useRef(
    isWatchRefreshStrategy(initialPaneState?.currentAutoRefreshStrategy ?? "off"),
  );

  const projectsLoadTokenRef = useRef(0);
  const sessionsLoadTokenRef = useRef(0);
  const bookmarksLoadTokenRef = useRef(0);
  const sessionScrollTopRef = useRef(initialSessionScrollTop);
  const sessionScrollSyncTimerRef = useRef<number | null>(null);
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
  } = useHistorySelectionState(initialPaneState);

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

  const rawUiSelectedProjectId = selection.projectId;
  const rawUiSelectedSessionId = selection.mode === "session" ? selection.sessionId : "";
  const uiHistoryMode = selection.mode;

  const naturallySortedProjects = useMemo(() => {
    const next = projects.filter((project) => enabledProviders.includes(project.provider));
    next.sort((left, right) => {
      const naturalOrder = compareProjectsByField(left, right, projectSortField);
      return projectSortDirection === "asc" ? naturalOrder : -naturalOrder;
    });
    return next;
  }, [enabledProviders, projectSortDirection, projectSortField, projects]);

  const projectOrderControlKey = useMemo(
    () =>
      [
        projectSortDirection,
        projectSortField,
        enabledProviders.join(","),
        projectProviders.join(","),
        projectQuery,
      ].join("\u0000"),
    [enabledProviders, projectProviders, projectQuery, projectSortDirection, projectSortField],
  );

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const nextIds = naturallySortedProjects.map((project) => project.id);
    const didProjectControlsChange = projectOrderControlKeyRef.current !== projectOrderControlKey;
    projectOrderControlKeyRef.current = projectOrderControlKey;

    setProjectOrderIds((current) => {
      if (didProjectControlsChange || projectListUpdateSource !== "auto" || current.length === 0) {
        return nextIds;
      }
      return mergeStableProjectOrder(current, nextIds);
    });
  }, [naturallySortedProjects, projectListUpdateSource, projectOrderControlKey]);

  const sortedProjects = useMemo(() => {
    if (projectOrderIds.length === 0) {
      return naturallySortedProjects;
    }
    const projectsById = new Map(
      naturallySortedProjects.map((project) => [project.id, project] as const),
    );
    return projectOrderIds
      .map((projectId) => projectsById.get(projectId) ?? null)
      .filter((project): project is ProjectSummary => project !== null);
  }, [naturallySortedProjects, projectOrderIds]);

  const sortedSessions = useMemo(
    () => sortSessionSummaries(sessions, sessionSortDirection),
    [sessionSortDirection, sessions],
  );
  const sortedTreeProjectSessionsByProjectId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(treeProjectSessionsByProjectId).map(([projectId, projectSessions]) => [
          projectId,
          sortSessionSummaries(projectSessions, sessionSortDirection),
        ]),
      ) as Record<string, SessionSummary[]>,
    [sessionSortDirection, treeProjectSessionsByProjectId],
  );

  const rawSelectedProjectId = committedSelection.projectId;
  const rawSelectedSessionId =
    committedSelection.mode === "session" ? committedSelection.sessionId : "";
  const historyMode = committedSelection.mode;
  const selectedProjectId = rawSelectedProjectId || sortedProjects[0]?.id || "";
  const selectedSessionId = rawSelectedSessionId;
  const uiSelectedProjectId = rawUiSelectedProjectId || sortedProjects[0]?.id || "";
  const uiSelectedSessionId = rawUiSelectedSessionId;

  useEffect(() => {
    treeProjectSessionsByProjectIdRef.current = treeProjectSessionsByProjectId;
  }, [treeProjectSessionsByProjectId]);

  useEffect(() => {
    treeProjectSessionsLoadingByProjectIdRef.current = treeProjectSessionsLoadingByProjectId;
  }, [treeProjectSessionsLoadingByProjectId]);
  const queueProjectTreeNoopCommit = useCallback(
    ({
      commitMode = "immediate",
      waitForKeyboardIdle = false,
    }: {
      commitMode?: HistorySelectionCommitMode;
      waitForKeyboardIdle?: boolean;
    } = {}) => {
      pendingProjectPaneFocusCommitModeRef.current = "immediate";
      pendingProjectPaneFocusWaitForKeyboardIdleRef.current = false;
      queueSelectionNoopCommit(commitMode, waitForKeyboardIdle);
    },
    [
      pendingProjectPaneFocusCommitModeRef,
      pendingProjectPaneFocusWaitForKeyboardIdleRef,
      queueSelectionNoopCommit,
    ],
  );

  useEffect(() => {
    const visibleProjectIds = new Set(sortedProjects.map((project) => project.id));
    setTreeProjectSessionsByProjectId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
      ),
    );
    setTreeProjectSessionsLoadingByProjectId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
      ),
    );
  }, [sortedProjects]);

  const ensureTreeProjectSessionsLoaded = useCallback(
    async (projectId: string) => {
      if (
        !projectId ||
        treeProjectSessionsLoadingByProjectIdRef.current[projectId] ||
        treeProjectSessionsByProjectIdRef.current[projectId]
      ) {
        return;
      }

      const requestToken = (treeProjectSessionsLoadTokenRef.current[projectId] ?? 0) + 1;
      treeProjectSessionsLoadTokenRef.current[projectId] = requestToken;
      setTreeProjectSessionsLoadingByProjectId((current) => ({
        ...current,
        [projectId]: true,
      }));
      try {
        const response = await codetrail.invoke("sessions:list", { projectId });
        if (treeProjectSessionsLoadTokenRef.current[projectId] !== requestToken) {
          return;
        }
        setTreeProjectSessionsByProjectId((current) => ({
          ...current,
          [projectId]: response.sessions,
        }));
      } catch (error) {
        logError("Failed loading tree sessions", error);
      } finally {
        if (treeProjectSessionsLoadTokenRef.current[projectId] === requestToken) {
          setTreeProjectSessionsLoadingByProjectId((current) => {
            const next = { ...current };
            delete next[projectId];
            return next;
          });
        }
      }
    },
    [codetrail, logError],
  );

  const refreshTreeProjectSessions = useCallback(async () => {
    const projectIds = Object.keys(treeProjectSessionsByProjectIdRef.current);
    if (projectIds.length === 0) {
      return;
    }
    try {
      const response = await codetrail.invoke("sessions:listMany", { projectIds });
      setTreeProjectSessionsByProjectId((current) => ({
        ...current,
        ...response.sessionsByProjectId,
      }));
    } catch (error) {
      logError("Failed refreshing tree sessions", error);
    }
  }, [codetrail, logError]);

  const projectProviderKey = useMemo(() => projectProviders.join(","), [projectProviders]);
  const {
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder,
    handleToggleAllFolders,
    handleToggleProjectExpansion,
  } = useProjectPaneTreeState({
    sortedProjects,
    selectedProjectId: uiSelectedProjectId,
    selectedSessionId: uiSelectedSessionId,
    sortField: projectSortField,
    sortDirection: projectSortDirection,
    viewMode: projectViewMode,
    updateSource: projectListUpdateSource,
    historyMode: uiHistoryMode,
    projectProvidersKey: projectProviderKey,
    projectQueryInput,
    onEnsureTreeProjectSessionsLoaded: ensureTreeProjectSessionsLoaded,
    autoRevealSessionRequest,
    onConsumeAutoRevealSessionRequest: () =>
      clearAutoRevealSessionRequest(setAutoRevealSessionRequest),
  });

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
      autoHideViewerHeaderActions: appearance.autoHideViewerHeaderActions,
      defaultViewerWrapMode: appearance.defaultViewerWrapMode,
      defaultDiffViewMode: appearance.defaultDiffViewMode,
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
      appearance.autoHideViewerHeaderActions,
      appearance.defaultViewerWrapMode,
      appearance.defaultDiffViewMode,
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
    ],
  );

  const paneSelectionState = useMemo(
    () => ({
      selectedProjectId,
      selectedSessionId,
      historyMode,
      sessionPage,
    }),
    [historyMode, selectedProjectId, selectedSessionId, sessionPage],
  );

  const paneSortState = useMemo(
    () => ({
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
      messageSortDirection,
      bookmarkSortDirection,
      projectAllSortDirection,
    }),
    [
      bookmarkSortDirection,
      messageSortDirection,
      projectAllSortDirection,
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
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
              value(selectionState.mode === "session" ? selectionState.sessionId : ""),
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
          selectionState.mode === "session" ? selectionState.sessionId : "",
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
    setAutoHideViewerHeaderActions: appearance.setAutoHideViewerHeaderActions,
    setDefaultViewerWrapMode: appearance.setDefaultViewerWrapMode,
    setDefaultDiffViewMode: appearance.setDefaultDiffViewMode,
    setPreferredExternalEditor: appearance.setPreferredExternalEditor,
    setPreferredExternalDiffTool: appearance.setPreferredExternalDiffTool,
    setTerminalAppCommand: appearance.setTerminalAppCommand,
    setExternalTools: appearance.setExternalTools,
    setHistorySelection: setHistorySelectionImmediate,
    setSelectedProjectId: setSelectedProjectIdForPaneStateSync,
    setSelectedSessionId: setSelectedSessionIdForPaneStateSync,
    setHistoryMode: setHistoryModeForPaneStateSync,
    setProjectViewMode,
    setProjectSortField,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

  useReconcileProviderSelection(enabledProviders, setProjectProviders);

  const hideSessionsPaneForTreeView = hideSessionsPaneInTreeView && projectViewMode === "tree";

  const registerAutoProjectUpdates = useCallback((deltas: Record<string, number>) => {
    const entries = Object.entries(deltas).filter(([, delta]) => delta > 0);
    if (entries.length === 0) {
      return;
    }

    const now = Date.now();
    setProjectUpdates((current) => {
      const next = { ...current };
      for (const [projectId, delta] of entries) {
        const previousDelta = next[projectId]?.messageDelta ?? 0;
        next[projectId] = {
          messageDelta: previousDelta + delta,
          updatedAt: now,
        };
      }
      return next;
    });

    for (const [projectId] of entries) {
      const existingTimeoutId = projectUpdateTimeoutsRef.current.get(projectId);
      if (existingTimeoutId !== undefined) {
        window.clearTimeout(existingTimeoutId);
      }
      const timeoutId = window.setTimeout(() => {
        setProjectUpdates((current) => {
          if (!(projectId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[projectId];
          return next;
        });
        projectUpdateTimeoutsRef.current.delete(projectId);
      }, PROJECT_UPDATE_HIGHLIGHT_MS);
      projectUpdateTimeoutsRef.current.set(projectId, timeoutId);
    }
  }, []);

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
      for (const timeoutId of projectUpdateTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      projectUpdateTimeoutsRef.current.clear();
    };
  }, [clearSelectionCommitTimer]);

  useEffect(() => {
    if (initialHistoryPaneFocusAppliedRef.current || !isHistoryLayout || !paneStateHydrated) {
      return;
    }
    initialHistoryPaneFocusAppliedRef.current = true;
    focusHistoryList(messageListRef.current);
  }, [isHistoryLayout, paneStateHydrated]);

  const {
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
    selectedSummaryMessageCount,
    historyCategoryExpandShortcutMap,
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
    visibleBookmarkedMessageIds,
    bookmarkSortDirection,
    projectCombinedDetail,
    sessionDetail,
    projectAllSortDirection,
    messageSortDirection,
    focusMessageId,
    sessionPage,
    messagePageSize: appearance.messagePageSize,
    expandedByDefaultCategories,
    isHistoryLayout,
    projectPaneCollapsed,
    projectPaneWidth,
    sessionPaneCollapsed,
    sessionPaneWidth,
  });

  useEffect(() => {
    selectedProjectRefreshFingerprintRef.current = getProjectRefreshFingerprint(selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    selectedSessionRefreshFingerprintRef.current = getSessionRefreshFingerprint(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    const visibleMessageIds = new Set(activeHistoryMessages.map((message) => message.id));
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
  }, [activeHistoryMessages]);

  useEffect(() => {
    const bookmarkStateRefreshKey = `${bookmarkStatesRefreshNonce}`;
    void bookmarkStateRefreshKey;

    if (!selectedProjectId) {
      setVisibleBookmarkedMessageIds([]);
      return;
    }
    if (historyMode === "bookmarks") {
      setVisibleBookmarkedMessageIds(
        bookmarksResponse.projectId === selectedProjectId
          ? bookmarksResponse.results.map((entry) => entry.message.id)
          : [],
      );
      return;
    }

    const messageIds = activeHistoryMessages.map((message) => message.id);
    if (messageIds.length === 0) {
      setVisibleBookmarkedMessageIds([]);
      return;
    }

    let cancelled = false;
    void codetrail
      .invoke("bookmarks:getStates", {
        projectId: selectedProjectId,
        messageIds,
      })
      .then((response) => {
        if (!cancelled) {
          setVisibleBookmarkedMessageIds(response.bookmarkedMessageIds);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVisibleBookmarkedMessageIds([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeHistoryMessages,
    bookmarksResponse.projectId,
    bookmarksResponse.results,
    bookmarkStatesRefreshNonce,
    codetrail,
    historyMode,
    selectedProjectId,
  ]);

  const refreshVisibleBookmarkStates = useCallback(() => {
    setBookmarkStatesRefreshNonce((value) => value + 1);
  }, []);

  useHistoryViewportEffects({
    messageListRef,
    historyMode,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    setSessionScrollTop,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
    refreshContextRef,
    pendingAutoScrollRef,
    prevMessageIdsRef,
    activeHistoryMessages,
    activeMessageSortDirection,
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
    scrollPreservationRef,
  });

  const {
    handleToggleHistoryCategoryShortcut,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleCategoryDefaultExpansion,
    handleToggleAllCategoryDefaultExpansion,
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
    codetrail,
    logError,
    setMessageExpanded: setMessageExpansionOverrides,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSessionPage,
    isExpandedByDefault,
    historyMode: uiHistoryMode,
    selection,
    bookmarkReturnSelection,
    bookmarksResponse,
    activeHistoryMessages,
    selectedProjectId: uiSelectedProjectId,
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
    setHistorySelection: (value, options) =>
      setHistorySelectionWithCommitMode(
        value,
        options?.commitMode ?? "immediate",
        options?.waitForKeyboardIdle ?? false,
      ),
    setBookmarkReturnSelection,
    sessionListRef,
    selectedSessionId: uiSelectedSessionId,
    sessionPaneNavigationItems,
    projectListRef,
    sortedProjects,
    projectViewMode,
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
    sessionSearchInputRef,
    projectPaneCollapsed,
    setProjectPaneCollapsed,
    sessionPaneCollapsed,
    hideSessionsPaneForTreeView,
    setProjectViewMode,
    setAutoRevealSessionRequest,
    loadProjects,
    loadSessions,
    refreshVisibleBookmarkStates,
    setProjectProviders,
    setProjectQueryInput,
    refreshContextRef,
    refreshTreeProjectSessions,
    pendingProjectPaneFocusCommitModeRef,
    pendingProjectPaneFocusWaitForKeyboardIdleRef,
    queueProjectTreeNoopCommit,
    treeFocusedRow,
    setTreeFocusedRow,
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

  const focusMessagePane = useCallback(() => {
    focusHistoryList(messageListRef.current);
  }, []);

  useEffect(() => {
    return codetrail.onHistoryExportProgress((progress: HistoryExportProgressPayload) => {
      setHistoryExportState((current) =>
        current.exportId !== progress.exportId
          ? current
          : {
              ...current,
              percent: progress.percent,
              phase: progress.phase,
              message: progress.message,
            },
      );
    });
  }, [codetrail]);

  const handleExportMessages = useCallback(
    async ({ scope }: { scope: HistoryExportScope }) => {
      if (!selectedProjectId) {
        return {
          canceled: true,
          path: null,
        };
      }

      const exportId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      setHistoryExportState({
        open: true,
        exportId,
        scope,
        percent: 1,
        phase: "preparing",
        message: "Preparing export…",
      });

      try {
        const response = await codetrail.invoke("history:exportMessages", {
          exportId,
          mode: historyMode,
          projectId: selectedProjectId,
          ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
          page: loadedHistoryPage,
          pageSize: appearance.messagePageSize,
          categories: historyCategories,
          query: historyMode === "bookmarks" ? effectiveBookmarkQuery : effectiveSessionQuery,
          searchMode,
          sortDirection: activeMessageSortDirection,
          scope,
        });
        setHistoryExportState((current) =>
          current.exportId === exportId
            ? { ...current, open: false, exportId: null, percent: 100, message: "" }
            : current,
        );
        return response;
      } catch (error) {
        setHistoryExportState((current) =>
          current.exportId === exportId
            ? { ...current, open: false, exportId: null, message: "" }
            : current,
        );
        logError("History messages export failed", error);
        throw error;
      }
    },
    [
      activeMessageSortDirection,
      appearance.messagePageSize,
      codetrail,
      effectiveBookmarkQuery,
      effectiveSessionQuery,
      historyCategories,
      historyMode,
      loadedHistoryPage,
      logError,
      searchMode,
      selectedProjectId,
      selectedSessionId,
    ],
  );

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
    historyCategories,
    setHistoryCategories,
    expandedByDefaultCategories,
    setExpandedByDefaultCategories,
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
    messagePageSize: appearance.messagePageSize,
    setMessagePageSize: appearance.setMessagePageSize,
    loadedHistoryPage,
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
    areAllMessagesExpanded,
    globalExpandCollapseLabel,
    messageExpansionOverrides,
    messagePathRoots,
    isExpandedByDefault,
    handleToggleHistoryCategoryShortcut,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleCategoryDefaultExpansion,
    handleToggleAllCategoryDefaultExpansion,
    handleToggleMessageExpanded,
    handleToggleBookmark,
    handleRevealInSession,
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
    focusMessagePane,
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
    goToHistoryPage,
    goToFirstHistoryPage,
    goToLastHistoryPage,
    goToPreviousHistoryPage,
    goToNextHistoryPage,
    handleRefresh,
    navigateFromSearchResult,
    setPendingSearchNavigation,
    pendingSearchNavigation,
    selectedSummaryMessageCount,
    historyCategoryExpandShortcutMap,
    historyCategoriesShortcutMap,
    prettyCategory,
    prettyProvider: formatPrettyProvider,
    formatDate,
    handleRefreshAllData: useCallback(
      async (
        source: "manual" | "auto" = "manual",
        options: { historyViewActive?: boolean } = {},
      ) => {
        const container = messageListRef.current;
        const id = ++refreshIdCounterRef.current;
        const historyViewActive = options.historyViewActive ?? true;

        const sortDir =
          historyMode === "project_all"
            ? projectAllSortDirection
            : historyMode === "bookmarks"
              ? bookmarkSortDirection
              : messageSortDirection;
        const scopeKey = getHistoryRefreshScopeKey(
          historyMode,
          selectedProjectId,
          selectedSessionId,
        );
        const baselineTotalCount = getRefreshBaselineTotalCount({
          historyMode,
          selectedProject,
          selectedSession,
          sessionDetail,
          projectCombinedDetailTotalCount: projectCombinedDetail?.totalCount,
          bookmarksResponse,
        });
        const isAtVisualEdge = container
          ? isPinnedToVisualRefreshEdge({
              sortDirection: sortDir,
              scrollTop: container.scrollTop,
              clientHeight: container.clientHeight,
              scrollHeight: container.scrollHeight,
            })
          : false;
        const isOnLiveEdgePage =
          historyMode !== "bookmarks" &&
          isLiveEdgePage({
            sortDirection: sortDir,
            page: sessionPage,
            totalCount: baselineTotalCount,
            pageSize: appearance.messagePageSize,
          });
        const followEligible = isAtVisualEdge && isOnLiveEdgePage;

        let scrollPreservation: RefreshContext["scrollPreservation"] = null;
        let prevMessageIds = "";

        if (followEligible) {
          prevMessageIds = getMessageListFingerprint(activeHistoryMessages);
        } else if (container) {
          const anchor = getVisibleMessageAnchor(container);
          scrollPreservation = anchor
            ? {
                scrollTop: container.scrollTop,
                referenceMessageId: anchor.referenceMessageId,
                referenceOffsetTop: anchor.referenceOffsetTop,
              }
            : null;
        }

        const refreshContext: RefreshContext = {
          refreshId: id,
          originPage: sessionPage,
          scopeKey,
          baselineTotalCount,
          followEligible,
          scrollPreservation,
          prevMessageIds,
        };
        const { projectSource, clearStartupWatchResort } = resolveProjectRefreshSource(
          source,
          startupWatchResortPendingRef.current,
        );
        const consumeRefreshContext = async (
          target: "bookmarks" | "session" | "project_all" | null,
        ) => {
          if (target === null) {
            refreshContextRef.current = null;
            return;
          }
          refreshContextRef.current = refreshContext;
          if (target === "bookmarks") {
            await loadBookmarks();
            return;
          }
          if (target === "session") {
            setSessionDetailRefreshNonce((value) => value + 1);
            return;
          }
          setProjectCombinedDetailRefreshNonce((value) => value + 1);
        };

        if (source === "manual") {
          const sharedLoads: Promise<unknown>[] = [
            loadProjects(projectSource),
            loadSessions(),
            refreshTreeProjectSessions(),
          ];
          if (historyMode !== "bookmarks") {
            sharedLoads.push(loadBookmarks());
          }
          await Promise.all(sharedLoads);
          if (clearStartupWatchResort) {
            startupWatchResortPendingRef.current = false;
          }
          const refreshTarget =
            historyMode === "bookmarks" && selectedProjectId
              ? "bookmarks"
              : historyMode === "session" && selectedSessionId
                ? "session"
                : historyMode === "project_all" && selectedProjectId
                  ? "project_all"
                  : null;
          await consumeRefreshContext(refreshTarget);
          return;
        }

        const previousProjectFingerprint = selectedProjectRefreshFingerprintRef.current;
        const previousSessionFingerprint = selectedSessionRefreshFingerprintRef.current;
        const nextProjects = await loadProjects(projectSource);
        if (clearStartupWatchResort) {
          startupWatchResortPendingRef.current = false;
        }
        const nextSelectedProject =
          nextProjects?.find((project) => project.id === selectedProjectId) ?? null;
        const projectFingerprintChanged =
          previousProjectFingerprint.length > 0 &&
          nextSelectedProject !== null &&
          getProjectRefreshFingerprint(nextSelectedProject) !== previousProjectFingerprint;

        let sessionFingerprintChanged = false;
        if (historyViewActive && selectedProjectId) {
          const nextSessions = await loadSessions();
          const nextSelectedSession =
            nextSessions?.find((session) => session.id === selectedSessionId) ?? null;
          sessionFingerprintChanged =
            previousSessionFingerprint.length > 0 &&
            nextSelectedSession !== null &&
            getSessionRefreshFingerprint(nextSelectedSession) !== previousSessionFingerprint;
        }

        const refreshTarget =
          historyMode === "bookmarks" && historyViewActive && selectedProjectId
            ? "bookmarks"
            : historyViewActive &&
                historyMode === "session" &&
                sessionFingerprintChanged &&
                selectedSessionId
              ? "session"
              : historyViewActive &&
                  historyMode === "project_all" &&
                  projectFingerprintChanged &&
                  selectedProjectId
                ? "project_all"
                : null;
        await consumeRefreshContext(refreshTarget);

        if (
          historyViewActive &&
          projectViewMode === "tree" &&
          Object.keys(treeProjectSessionsByProjectIdRef.current).length > 0
        ) {
          await refreshTreeProjectSessions();
        }
      },
      [
        activeHistoryMessages,
        appearance.messagePageSize,
        bookmarkSortDirection,
        historyMode,
        loadBookmarks,
        loadProjects,
        loadSessions,
        messageSortDirection,
        bookmarksResponse,
        projectCombinedDetail,
        projectAllSortDirection,
        projectViewMode,
        refreshTreeProjectSessions,
        sessionPage,
        selectedProject,
        selectedProjectId,
        selectedSession,
        selectedSessionId,
        sessionDetail,
      ],
    ),
  };
}
