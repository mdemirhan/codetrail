import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type {
  MessageCategory,
  Provider,
  SearchMode,
  SystemMessageRegexRules,
} from "@codetrail/core/browser";

import type { HistoryExportPhase, HistoryExportProgressPayload } from "../../shared/historyExport";
import { DEFAULT_PREFERRED_REFRESH_STRATEGY, type NonOffRefreshStrategy } from "../app/autoRefresh";
import {
  DEFAULT_MESSAGE_CATEGORIES,
  EMPTY_BOOKMARKS_RESPONSE,
  EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  PAGE_SIZE,
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
  HistoryExportScope,
  HistorySearchNavigation,
  HistorySelection,
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
} from "../app/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePaneStateSync } from "../hooks/usePaneStateSync";
import { useReconcileProviderSelection } from "../hooks/useReconcileProviderSelection";
import { useResizablePanes } from "../hooks/useResizablePanes";
import { useCodetrailClient } from "../lib/codetrailClient";
import { getEdgeItemId } from "../lib/historyNavigation";
import { mergeStableProjectOrder } from "../lib/projectUpdates";
import { clamp, compareRecent, sessionActivityOf } from "../lib/viewUtils";
import {
  type AppearanceState,
  focusHistoryList,
  scrollFocusedHistoryMessageIntoView,
} from "./historyControllerShared";
import { useHistoryDataEffects } from "./useHistoryDataEffects";
import { useHistoryDerivedState } from "./useHistoryDerivedState";
import { useHistoryInteractions } from "./useHistoryInteractions";

export type RefreshContext = {
  refreshId: number;
  originPage: number;
  scrollPreservation: {
    scrollTop: number;
    referenceMessageId: string;
    referenceOffsetTop: number;
  } | null;
  autoScroll: boolean;
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

// ── Periodic-refresh scroll policy ──────────────────────────────────────────
//
// There is no manual auto-scroll toggle. Instead, auto-scroll is detected
// automatically based on scroll position at refresh time:
//
//   ASC sort → pinned when scrolled to the bottom (within threshold)
//   DESC sort → pinned when scrolled to the top (within threshold)
//
// This follows the same convention as terminal emulators and chat apps:
// if you're at the edge where new content appears, you stay pinned; if
// you've scrolled away, new content arrives without disturbing the viewport.
//
// Edge-pinned (at newest-messages edge):
//   Navigate to the page containing the newest messages (last page for ASC,
//   page 0 for DESC) and scroll to the corresponding edge. If message IDs
//   haven't changed since the previous tick, skip the scroll entirely.
//
// Not edge-pinned (scrolled away):
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
  const [selection, setHistorySelection] = useState<HistorySelection>(() =>
    createHistorySelectionFromPaneState(initialPaneState),
  );
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
  const [bookmarkReturnSelection, setBookmarkReturnSelection] = useState<HistorySelection | null>(
    null,
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
  const refreshIdCounterRef = useRef(0);
  const treeProjectSessionsLoadTokenRef = useRef<Record<string, number>>({});
  const treeProjectSessionsByProjectIdRef = useRef<Record<string, SessionSummary[]>>({});
  const treeProjectSessionsLoadingByProjectIdRef = useRef<Record<string, boolean>>({});
  const initialHistoryPaneFocusAppliedRef = useRef(false);
  const projectsRef = useRef<ProjectSummary[]>([]);
  const projectUpdateTimeoutsRef = useRef<Map<string, number>>(new Map());
  const projectOrderControlKeyRef = useRef("");

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

  const selectedProjectId = rawSelectedProjectId || sortedProjects[0]?.id || "";
  const selectedSessionId = rawSelectedSessionId;

  useEffect(() => {
    treeProjectSessionsByProjectIdRef.current = treeProjectSessionsByProjectId;
  }, [treeProjectSessionsByProjectId]);

  useEffect(() => {
    treeProjectSessionsLoadingByProjectIdRef.current = treeProjectSessionsLoadingByProjectId;
  }, [treeProjectSessionsLoadingByProjectId]);

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
    const responses = await Promise.allSettled(
      projectIds.map(
        async (projectId) =>
          [projectId, (await codetrail.invoke("sessions:list", { projectId })).sessions] as const,
      ),
    );
    const successfulResponses = responses.flatMap((response, index) => {
      if (response.status === "fulfilled") {
        return [response.value];
      }
      logError(
        `Failed refreshing tree sessions for project ${projectIds[index] ?? "(unknown project)"}`,
        response.reason,
      );
      return [];
    });
    if (successfulResponses.length === 0) {
      return;
    }
    setTreeProjectSessionsByProjectId((current) => ({
      ...current,
      ...Object.fromEntries(successfulResponses),
    }));
  }, [codetrail, logError]);

  const paneAppearanceState = useMemo(
    () => ({
      theme: appearance.theme,
      monoFontFamily: appearance.monoFontFamily,
      regularFontFamily: appearance.regularFontFamily,
      monoFontSize: appearance.monoFontSize,
      regularFontSize: appearance.regularFontSize,
      useMonospaceForAllMessages: appearance.useMonospaceForAllMessages,
    }),
    [
      appearance.monoFontFamily,
      appearance.monoFontSize,
      appearance.regularFontFamily,
      appearance.regularFontSize,
      appearance.theme,
      appearance.useMonospaceForAllMessages,
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
      preferredAutoRefreshStrategy,
      systemMessageRegexRules,
    }),
    [
      enabledProviders,
      expandedByDefaultCategories,
      historyCategories,
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
    setEnabledProviders,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setSingleClickFoldersExpand,
    setSingleClickProjectsExpand,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setPreferredAutoRefreshStrategy,
    setRemoveMissingSessionsDuringIncrementalIndexing,
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
    rawSelectedProjectId,
    selectedProjectId,
    selectedSessionId,
    sortedProjects,
    sortedSessions,
    pendingSearchNavigation,
    setPendingSearchNavigation,
    setHistorySelection,
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
    refreshContextRef,
  });

  useEffect(() => {
    return () => {
      if (sessionScrollSyncTimerRef.current !== null) {
        window.clearTimeout(sessionScrollSyncTimerRef.current);
      }
      for (const timeoutId of projectUpdateTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      projectUpdateTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (initialHistoryPaneFocusAppliedRef.current || !isHistoryLayout || !paneStateHydrated) {
      return;
    }
    initialHistoryPaneFocusAppliedRef.current = true;
    focusHistoryList(messageListRef.current);
  }, [isHistoryLayout, paneStateHydrated]);

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

    // Refresh-triggered page change (auto-scroll only): transfer auto-scroll data to the refs
    // the layout effect consumes, then skip the scroll reset. Scroll-preservation mode never
    // changes pages — it always re-fetches the same sessionPage — so no cross-page handling needed.
    const refreshCtx = refreshContextRef.current;
    if (refreshCtx?.autoScroll) {
      pendingAutoScrollRef.current = true;
      prevMessageIdsRef.current = refreshCtx.prevMessageIds;
      refreshContextRef.current = null;
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

    // Same-page refresh: the scroll-reset effect did not fire (page unchanged), so
    // refreshContextRef is still populated. Consume it here directly.
    const refreshCtx = refreshContextRef.current;
    if (refreshCtx !== null) {
      refreshContextRef.current = null;
      if (refreshCtx.autoScroll) {
        const currentIds = activeHistoryMessages.map((m) => m.id).join(",");
        if (currentIds !== refreshCtx.prevMessageIds) {
          window.requestAnimationFrame(() => {
            container.scrollTop = activeMessageSortDirection === "asc" ? container.scrollHeight : 0;
          });
        }
        return;
      }
      if (refreshCtx.scrollPreservation) {
        const saved = refreshCtx.scrollPreservation;
        const refEl = container.querySelector<HTMLElement>(
          `[data-history-message-id="${CSS.escape(saved.referenceMessageId)}"]`,
        );
        if (refEl) {
          container.scrollTop = saved.scrollTop + (refEl.offsetTop - saved.referenceOffsetTop);
          return;
        }
        container.scrollTop = saved.scrollTop;
        return;
      }
    }

    // Cross-page auto-scroll: populated by the scroll-reset effect when page changed.
    if (pendingAutoScrollRef.current) {
      pendingAutoScrollRef.current = false;
      const currentIds = activeHistoryMessages.map((m) => m.id).join(",");
      if (currentIds !== prevMessageIdsRef.current) {
        prevMessageIdsRef.current = currentIds;
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

    // Same-page scroll preservation via scrollPreservationRef (drift compensation).
    const saved = scrollPreservationRef.current;
    if (!saved) return;
    scrollPreservationRef.current = null;

    if (saved.referenceMessageId) {
      const refEl = container.querySelector<HTMLElement>(
        `[data-history-message-id="${CSS.escape(saved.referenceMessageId)}"]`,
      );
      if (refEl) {
        container.scrollTop = saved.scrollTop + (refEl.offsetTop - saved.referenceOffsetTop);
        return;
      }
    }
    // Fallback: preserve raw scrollTop
    container.scrollTop = saved.scrollTop;
  }, [activeHistoryMessages, activeMessageSortDirection]);

  const {
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
    refreshContextRef,
    refreshTreeProjectSessions,
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
          page: historyMode === "bookmarks" ? 0 : loadedHistoryPage,
          pageSize: PAGE_SIZE,
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
    paneStateHydrated,
    sortedProjects,
    projectUpdates,
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
    handleToggleCategoryMessagesExpanded,
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
    handleExportMessages,
    historyExportState,
    selectProjectAllMessages,
    selectBookmarksView,
    openProjectBookmarksView,
    closeBookmarksView,
    selectSessionView,
    ensureTreeProjectSessionsLoaded,
    selectAdjacentSession,
    selectAdjacentProject,
    handleProjectTreeArrow,
    handleProjectTreeEnter,
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
      async (source: "manual" | "auto" = "manual") => {
        const container = messageListRef.current;
        const id = ++refreshIdCounterRef.current;

        // Detect whether the user is "pinned" to the newest-messages edge.
        // ASC → newest at bottom → pinned when scrolled to bottom.
        // DESC → newest at top → pinned when scrolled to top.
        const sortDir =
          historyMode === "project_all"
            ? projectAllSortDirection
            : historyMode === "bookmarks"
              ? bookmarkSortDirection
              : messageSortDirection;
        const edgeThreshold = 10;
        const isAtNewestEdge = (() => {
          if (!container) return false;
          if (sortDir === "asc") {
            return (
              container.scrollTop + container.clientHeight >= container.scrollHeight - edgeThreshold
            );
          }
          return container.scrollTop <= edgeThreshold;
        })();

        let scrollPreservation: RefreshContext["scrollPreservation"] = null;
        let prevMessageIds = "";

        if (isAtNewestEdge) {
          prevMessageIds = container
            ? Array.from(
                container.querySelectorAll<HTMLElement>("[data-history-message-id]"),
                (el) => el.getAttribute("data-history-message-id"),
              ).join(",")
            : "";
        } else if (container) {
          const elements = Array.from(
            container.querySelectorAll<HTMLElement>("[data-history-message-id]"),
          );
          for (const el of elements) {
            if (el.offsetTop + el.offsetHeight > container.scrollTop) {
              scrollPreservation = {
                scrollTop: container.scrollTop,
                referenceMessageId: el.getAttribute("data-history-message-id") ?? "",
                referenceOffsetTop: el.offsetTop,
              };
              break;
            }
          }
        }

        refreshContextRef.current = {
          refreshId: id,
          originPage: sessionPage,
          scrollPreservation,
          autoScroll: isAtNewestEdge,
          prevMessageIds,
        };

        await handleRefresh(source);
        setRefreshCounter((c) => c + 1);
      },
      [
        bookmarkSortDirection,
        handleRefresh,
        historyMode,
        messageSortDirection,
        projectAllSortDirection,
        sessionPage,
      ],
    ),
  };
}
