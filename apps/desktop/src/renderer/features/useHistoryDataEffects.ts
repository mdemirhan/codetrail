import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core/browser";

import { CATEGORIES, EMPTY_BOOKMARKS_RESPONSE } from "../app/constants";
import {
  createHistorySelection,
  setHistorySelectionProjectId,
  setHistorySelectionSessionId,
} from "../app/historySelection";
import type {
  BookmarkListResponse,
  HistorySearchNavigation,
  HistorySelection,
  PendingRevealTarget,
  ProjectCombinedDetail,
  ProjectSummary,
  SessionDetail,
  SessionSummary,
  SortDirection,
} from "../app/types";
import { shouldIgnoreAsyncEffectError } from "../lib/asyncEffectUtils";
import type { CodetrailClient } from "../lib/codetrailClient";
import { type StableListUpdateSource, collectProjectMessageDeltas } from "../lib/projectUpdates";
import { decideSessionSelectionAfterLoad } from "../lib/sessionSelection";
import { getHistoryRefreshScopeKey, getLiveEdgePage } from "./historyRefreshPolicy";
import type { RefreshContext } from "./useHistoryController";

// This hook owns the async side of history state: loading projects/sessions/details and reconciling
// in-flight requests with the controller's current selection.
export function useHistoryDataEffects({
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
  messagePageSize,
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
}: {
  codetrail: CodetrailClient;
  logError: (context: string, error: unknown) => void;
  projectProviders: Provider[];
  projectQuery: string;
  rawSelectedProjectId: string;
  selectedProjectId: string;
  selectedSessionId: string;
  sortedProjects: ProjectSummary[];
  sortedSessions: SessionSummary[];
  pendingSearchNavigation: HistorySearchNavigation | null;
  setPendingSearchNavigation: Dispatch<SetStateAction<HistorySearchNavigation | null>>;
  setHistorySelection: Dispatch<SetStateAction<HistorySelection>>;
  setProjects: Dispatch<SetStateAction<ProjectSummary[]>>;
  projectsRef: MutableRefObject<ProjectSummary[]>;
  setProjectListUpdateSource: Dispatch<SetStateAction<StableListUpdateSource>>;
  registerAutoProjectUpdates: (deltas: Record<string, number>) => void;
  setProjectsLoaded: Dispatch<SetStateAction<boolean>>;
  projectsLoaded: boolean;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setSessionListUpdateSource: Dispatch<SetStateAction<StableListUpdateSource>>;
  setSessionsLoadedProjectId: Dispatch<SetStateAction<string | null>>;
  setBookmarksResponse: Dispatch<SetStateAction<BookmarkListResponse>>;
  setBookmarksLoadedProjectId: Dispatch<SetStateAction<string | null>>;
  historyCategories: MessageCategory[];
  effectiveBookmarkQuery: string;
  effectiveSessionQuery: string;
  searchMode: SearchMode;
  paneStateHydrated: boolean;
  historyMode: HistorySelection["mode"];
  setSessionPage: Dispatch<SetStateAction<number>>;
  setSessionQueryInput: Dispatch<SetStateAction<string>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
  setPendingRevealTarget: Dispatch<SetStateAction<PendingRevealTarget | null>>;
  pendingRevealTarget: PendingRevealTarget | null;
  bookmarkSortDirection: SortDirection;
  messageSortDirection: SortDirection;
  projectAllSortDirection: SortDirection;
  sessionPage: number;
  messagePageSize: number;
  setSessionDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setProjectCombinedDetail: Dispatch<SetStateAction<ProjectCombinedDetail | null>>;
  bookmarksLoadedProjectId: string | null;
  bookmarksResponse: BookmarkListResponse;
  setSessionPaneStableProjectId: Dispatch<SetStateAction<string | null>>;
  sessionsLoadedProjectId: string | null;
  projectsLoadTokenRef: MutableRefObject<number>;
  sessionsLoadTokenRef: MutableRefObject<number>;
  bookmarksLoadTokenRef: MutableRefObject<number>;
  sessionDetailRefreshNonce: number;
  projectCombinedDetailRefreshNonce: number;
  refreshContextRef: MutableRefObject<RefreshContext | null>;
}) {
  const projectsLoadedStateRef = useRef(projectsLoaded);
  useEffect(() => {
    projectsLoadedStateRef.current = projectsLoaded;
  }, [projectsLoaded]);

  const loadProjects = useCallback(
    async (source: StableListUpdateSource = "resort") => {
      // Monotonic request tokens prevent stale async responses from overwriting newer selections.
      const requestToken = projectsLoadTokenRef.current + 1;
      projectsLoadTokenRef.current = requestToken;
      const wasLoaded = projectsLoadedStateRef.current;
      if (!wasLoaded) {
        setProjectsLoaded(false);
      }
      try {
        const response = await codetrail.invoke("projects:list", {
          providers: projectProviders,
          query: projectQuery,
        });
        if (requestToken !== projectsLoadTokenRef.current) {
          return;
        }
        setProjectListUpdateSource(source);
        if (source === "auto") {
          registerAutoProjectUpdates(
            collectProjectMessageDeltas(projectsRef.current, response.projects),
          );
        }
        setProjects(response.projects);
        setProjectsLoaded(true);
        return response.projects;
      } catch (error) {
        if (requestToken === projectsLoadTokenRef.current && wasLoaded) {
          setProjectsLoaded(true);
        }
        throw error;
      }
    },
    [
      codetrail,
      projectProviders,
      projectQuery,
      projectsRef,
      projectsLoadTokenRef,
      registerAutoProjectUpdates,
      setProjectListUpdateSource,
      setProjects,
      setProjectsLoaded,
    ],
  );

  const loadSessions = useCallback(
    async (source: StableListUpdateSource = "resort") => {
      const requestToken = sessionsLoadTokenRef.current + 1;
      sessionsLoadTokenRef.current = requestToken;
      if (!selectedProjectId) {
        setSessions([]);
        setSessionListUpdateSource("resort");
        setSessionsLoadedProjectId("");
        setHistorySelection((value) =>
          value.mode === "session" ? createHistorySelection("project_all", "", "") : value,
        );
        return [];
      }

      setSessionsLoadedProjectId(null);
      const response = await codetrail.invoke("sessions:list", {
        projectId: selectedProjectId,
      });
      if (requestToken !== sessionsLoadTokenRef.current) {
        return;
      }
      setSessions(response.sessions);
      setSessionListUpdateSource(source);
      setSessionsLoadedProjectId(selectedProjectId);
      return response.sessions;
    },
    [
      codetrail,
      selectedProjectId,
      sessionsLoadTokenRef,
      setHistorySelection,
      setSessionListUpdateSource,
      setSessions,
      setSessionsLoadedProjectId,
    ],
  );

  const loadBookmarks = useCallback(async () => {
    const requestToken = bookmarksLoadTokenRef.current + 1;
    bookmarksLoadTokenRef.current = requestToken;
    if (!selectedProjectId) {
      setBookmarksResponse(EMPTY_BOOKMARKS_RESPONSE);
      setBookmarksLoadedProjectId("");
      return EMPTY_BOOKMARKS_RESPONSE;
    }
    setBookmarksLoadedProjectId(null);
    if (historyMode !== "bookmarks") {
      const response = await codetrail.invoke("bookmarks:listProject", {
        projectId: selectedProjectId,
        page: 0,
        pageSize: 1,
        countOnly: true,
      });
      if (requestToken !== bookmarksLoadTokenRef.current) {
        return;
      }
      setBookmarksResponse(response);
      setBookmarksLoadedProjectId(selectedProjectId);
      return response;
    }
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const response = await codetrail.invoke("bookmarks:listProject", {
      projectId: selectedProjectId,
      page: sessionPage,
      pageSize: messagePageSize,
      sortDirection: bookmarkSortDirection,
      query: effectiveBookmarkQuery,
      searchMode,
      categories: isAllHistoryCategoriesSelected ? undefined : historyCategories,
    });
    if (requestToken !== bookmarksLoadTokenRef.current) {
      return;
    }
    setBookmarksResponse(response);
    if (typeof response.page === "number" && response.page !== sessionPage) {
      setSessionPage(response.page);
    }
    setBookmarksLoadedProjectId(selectedProjectId);
    return response;
  }, [
    bookmarksLoadTokenRef,
    bookmarkSortDirection,
    codetrail,
    effectiveBookmarkQuery,
    historyCategories,
    historyMode,
    messagePageSize,
    searchMode,
    sessionPage,
    selectedProjectId,
    setBookmarksLoadedProjectId,
    setBookmarksResponse,
    setSessionPage,
  ]);

  const refreshInvalidationKey = useMemo(
    () =>
      [
        effectiveBookmarkQuery,
        effectiveSessionQuery,
        historyCategories.join(","),
        bookmarkSortDirection,
        messageSortDirection,
        projectAllSortDirection,
        searchMode,
      ].join("\u0000"),
    [
      effectiveBookmarkQuery,
      effectiveSessionQuery,
      historyCategories,
      bookmarkSortDirection,
      messageSortDirection,
      projectAllSortDirection,
      searchMode,
    ],
  );
  const previousRefreshInvalidationKeyRef = useRef(refreshInvalidationKey);

  const sessionDetailRequest = useMemo(
    () => ({
      historyMode,
      selectedSessionId,
      sessionPage,
      historyCategories,
      effectiveSessionQuery,
      searchMode,
      messageSortDirection,
      pendingRevealTarget,
      sessionDetailRefreshNonce,
    }),
    [
      effectiveSessionQuery,
      historyCategories,
      historyMode,
      messageSortDirection,
      pendingRevealTarget,
      sessionDetailRefreshNonce,
      searchMode,
      selectedSessionId,
      sessionPage,
    ],
  );

  const projectCombinedDetailRequest = useMemo(
    () => ({
      historyMode,
      selectedProjectId,
      sessionPage,
      historyCategories,
      effectiveSessionQuery,
      searchMode,
      projectAllSortDirection,
      pendingRevealTarget,
      projectCombinedDetailRefreshNonce,
    }),
    [
      effectiveSessionQuery,
      historyCategories,
      historyMode,
      pendingRevealTarget,
      projectAllSortDirection,
      projectCombinedDetailRefreshNonce,
      searchMode,
      selectedProjectId,
      sessionPage,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void loadProjects().catch((error: unknown) => {
      if (!cancelled) {
        logError("Failed loading projects", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjects, logError]);

  useEffect(() => {
    if (!projectsLoaded) {
      return;
    }
    if (!sortedProjects.length) {
      if (!pendingSearchNavigation) {
        setHistorySelection(createHistorySelection("project_all", "", ""));
      }
      return;
    }

    if (!pendingSearchNavigation && !rawSelectedProjectId) {
      setHistorySelection((selectionState) =>
        setHistorySelectionProjectId(selectionState, sortedProjects[0]?.id ?? ""),
      );
    }
  }, [
    pendingSearchNavigation,
    projectsLoaded,
    rawSelectedProjectId,
    setHistorySelection,
    sortedProjects,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadSessions().catch((error: unknown) => {
      if (!cancelled) {
        logError("Failed loading sessions", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessions, logError]);

  useEffect(() => {
    let cancelled = false;
    void loadBookmarks().catch((error: unknown) => {
      if (!cancelled) {
        logError("Failed loading bookmarks", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadBookmarks, logError]);

  useEffect(() => {
    const decision = decideSessionSelectionAfterLoad({
      paneStateHydrated,
      sessionsLoadedProjectId,
      selectedProjectId,
      hasPendingSearchNavigation:
        pendingSearchNavigation !== null ||
        historyMode === "bookmarks" ||
        historyMode === "project_all",
      selectedSessionId,
      sortedSessions,
    });
    if (!decision) {
      return;
    }

    setHistorySelection((selectionState) =>
      setHistorySelectionSessionId(selectionState, decision.nextSelectedSessionId),
    );
    if (decision.resetPage) {
      setSessionPage(0);
    }
  }, [
    historyMode,
    paneStateHydrated,
    pendingSearchNavigation,
    selectedProjectId,
    selectedSessionId,
    sessionsLoadedProjectId,
    setHistorySelection,
    setSessionPage,
    sortedSessions,
  ]);

  useEffect(() => {
    if (!pendingSearchNavigation) {
      return;
    }

    // Search navigation is a two-step handshake: first move to the right project, then reveal the
    // target in either project-wide or session-scoped history once the required data is available.
    if (pendingSearchNavigation.projectId !== selectedProjectId) {
      if (pendingSearchNavigation.targetMode === "project_all") {
        setHistorySelection(
          createHistorySelection("project_all", pendingSearchNavigation.projectId),
        );
      } else {
        setHistorySelection((selectionState) =>
          setHistorySelectionProjectId(selectionState, pendingSearchNavigation.projectId),
        );
      }
      return;
    }

    if (pendingSearchNavigation.targetMode === "session") {
      if (!sortedSessions.some((session) => session.id === pendingSearchNavigation.sessionId)) {
        return;
      }

      setHistorySelection({
        mode: "session",
        projectId: pendingSearchNavigation.projectId,
        sessionId: pendingSearchNavigation.sessionId,
      });
    } else {
      setHistorySelection(createHistorySelection("project_all", pendingSearchNavigation.projectId));
    }
    setSessionQueryInput("");
    setHistoryCategories([...pendingSearchNavigation.historyCategories]);
    setSessionPage(0);
    setFocusMessageId(pendingSearchNavigation.messageId);
    setPendingRevealTarget({
      sourceId: pendingSearchNavigation.sourceId,
      messageId: pendingSearchNavigation.messageId,
    });
    setPendingSearchNavigation(null);
  }, [
    pendingSearchNavigation,
    selectedProjectId,
    setFocusMessageId,
    setHistoryCategories,
    setHistorySelection,
    setPendingRevealTarget,
    setPendingSearchNavigation,
    setSessionPage,
    setSessionQueryInput,
    sortedSessions,
  ]);

  useEffect(() => {
    if (historyMode !== "bookmarks" || bookmarksLoadedProjectId !== selectedProjectId) {
      return;
    }
    if (bookmarksResponse.totalCount > 0) {
      return;
    }
    setHistorySelection((selectionState) =>
      createHistorySelection("project_all", selectionState.projectId),
    );
  }, [
    bookmarksLoadedProjectId,
    bookmarksResponse.totalCount,
    historyMode,
    selectedProjectId,
    setHistorySelection,
  ]);

  // Invalidate stale refresh context when user-driven state changes (sort direction, category
  // filters, search query/mode) would cause data effects to re-fire. The refresh nonces are
  // intentionally not part of this key, so this effect only fires for user actions, never for
  // refresh ticks. React runs effects in declaration order, so this clears the ref before the
  // detail effects read it.
  // Bookmark sort direction participates here because bookmark pagination must be computed against
  // the requested order before the backend applies LIMIT/OFFSET.
  useEffect(() => {
    if (previousRefreshInvalidationKeyRef.current === refreshInvalidationKey) {
      return;
    }
    previousRefreshInvalidationKeyRef.current = refreshInvalidationKey;
    refreshContextRef.current = null;
  }, [refreshContextRef, refreshInvalidationKey]);

  useEffect(() => {
    if (sessionDetailRequest.historyMode !== "session" || !sessionDetailRequest.selectedSessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    const isRevealing = sessionDetailRequest.pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected =
      sessionDetailRequest.historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected
      ? undefined
      : sessionDetailRequest.historyCategories;
    // When revealing a specific message from bookmarks/search, temporarily ignore the free-text
    // query so pagination can land on the target even if it would otherwise be filtered out.
    const effectiveQuery = isRevealing ? "" : sessionDetailRequest.effectiveSessionQuery;

    // Capture refresh context at effect start for race protection.
    const refreshCtx = refreshContextRef.current;
    const isRefresh = refreshCtx !== null && !isRevealing;
    const currentScopeKey = getHistoryRefreshScopeKey(
      sessionDetailRequest.historyMode,
      selectedProjectId,
      sessionDetailRequest.selectedSessionId,
    );

    void codetrail
      .invoke("sessions:getDetail", {
        sessionId: sessionDetailRequest.selectedSessionId,
        page: sessionDetailRequest.sessionPage,
        pageSize: messagePageSize,
        categories: effectiveCategories,
        query: effectiveQuery,
        searchMode: sessionDetailRequest.searchMode,
        sortDirection: sessionDetailRequest.messageSortDirection,
        focusMessageId: sessionDetailRequest.pendingRevealTarget?.messageId || undefined,
        focusSourceId: sessionDetailRequest.pendingRevealTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        // Race protection: if a newer refresh started or user navigated, discard.
        if (isRefresh && refreshContextRef.current?.refreshId !== refreshCtx.refreshId) {
          return;
        }
        const shouldFollow =
          isRefresh &&
          refreshCtx.followEligible &&
          refreshCtx.scopeKey === currentScopeKey &&
          response.totalCount > refreshCtx.baselineTotalCount;
        if (isRefresh && refreshCtx.followEligible && !shouldFollow) {
          refreshContextRef.current = null;
        }
        setSessionDetail(response);
        if (sessionDetailRequest.pendingRevealTarget !== null) {
          setPendingRevealTarget(null);
        }
        if (shouldFollow) {
          const latestPage = getLiveEdgePage({
            sortDirection: sessionDetailRequest.messageSortDirection,
            totalCount: response.totalCount,
            pageSize: messagePageSize,
          });
          if (sessionDetailRequest.sessionPage !== latestPage) {
            setSessionPage(latestPage);
            return;
          }
        }
        if (response.page !== sessionDetailRequest.sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
          logError("Failed loading session detail", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    logError,
    messagePageSize,
    refreshContextRef,
    selectedProjectId,
    sessionDetailRequest,
    setPendingRevealTarget,
    setSessionDetail,
    setSessionPage,
  ]);

  useEffect(() => {
    if (
      projectCombinedDetailRequest.historyMode !== "project_all" ||
      !projectCombinedDetailRequest.selectedProjectId
    ) {
      setProjectCombinedDetail(null);
      return;
    }

    let cancelled = false;
    const isRevealing = projectCombinedDetailRequest.pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected =
      projectCombinedDetailRequest.historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected
      ? undefined
      : projectCombinedDetailRequest.historyCategories;
    const effectiveQuery = isRevealing ? "" : projectCombinedDetailRequest.effectiveSessionQuery;

    const refreshCtx = refreshContextRef.current;
    const isRefresh = refreshCtx !== null && !isRevealing;
    const currentScopeKey = getHistoryRefreshScopeKey(
      projectCombinedDetailRequest.historyMode,
      projectCombinedDetailRequest.selectedProjectId,
      selectedSessionId,
    );

    void codetrail
      .invoke("projects:getCombinedDetail", {
        projectId: projectCombinedDetailRequest.selectedProjectId,
        page: projectCombinedDetailRequest.sessionPage,
        pageSize: messagePageSize,
        categories: effectiveCategories,
        query: effectiveQuery,
        searchMode: projectCombinedDetailRequest.searchMode,
        sortDirection: projectCombinedDetailRequest.projectAllSortDirection,
        focusMessageId: projectCombinedDetailRequest.pendingRevealTarget?.messageId || undefined,
        focusSourceId: projectCombinedDetailRequest.pendingRevealTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (isRefresh && refreshContextRef.current?.refreshId !== refreshCtx.refreshId) {
          return;
        }
        const shouldFollow =
          isRefresh &&
          refreshCtx.followEligible &&
          refreshCtx.scopeKey === currentScopeKey &&
          response.totalCount > refreshCtx.baselineTotalCount;
        if (isRefresh && refreshCtx.followEligible && !shouldFollow) {
          refreshContextRef.current = null;
        }
        setProjectCombinedDetail(response);
        if (projectCombinedDetailRequest.pendingRevealTarget !== null) {
          setPendingRevealTarget(null);
        }
        if (shouldFollow) {
          const latestPage = getLiveEdgePage({
            sortDirection: projectCombinedDetailRequest.projectAllSortDirection,
            totalCount: response.totalCount,
            pageSize: messagePageSize,
          });
          if (projectCombinedDetailRequest.sessionPage !== latestPage) {
            setSessionPage(latestPage);
            return;
          }
        }
        if (response.page !== projectCombinedDetailRequest.sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
          logError("Failed loading project combined detail", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    logError,
    messagePageSize,
    projectCombinedDetailRequest,
    refreshContextRef,
    selectedSessionId,
    setPendingRevealTarget,
    setProjectCombinedDetail,
    setSessionPage,
  ]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSessionPaneStableProjectId(null);
      return;
    }
    const bookmarksReady =
      historyMode === "bookmarks" ? bookmarksLoadedProjectId === selectedProjectId : true;
    if (sessionsLoadedProjectId === selectedProjectId && bookmarksReady) {
      setSessionPaneStableProjectId((value) =>
        value === selectedProjectId ? value : selectedProjectId,
      );
    }
  }, [
    bookmarksLoadedProjectId,
    historyMode,
    selectedProjectId,
    sessionsLoadedProjectId,
    setSessionPaneStableProjectId,
  ]);

  return {
    loadProjects,
    loadSessions,
    loadBookmarks,
  };
}
