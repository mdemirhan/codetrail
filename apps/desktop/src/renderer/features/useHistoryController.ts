import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, UIEvent as ReactUIEvent } from "react";

import type { MessageCategory, Provider, SearchMode, SystemMessageRegexRules } from "@codetrail/core";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import {
  BOOKMARKS_NAV_ID,
  CATEGORIES,
  COLLAPSED_PANE_WIDTH,
  DEFAULT_MESSAGE_CATEGORIES,
  EMPTY_BOOKMARKS_RESPONSE,
  EMPTY_CATEGORY_COUNTS,
  EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  HISTORY_CATEGORY_SHORTCUTS,
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
import { decideSessionSelectionAfterLoad } from "../lib/sessionSelection";
import {
  clamp,
  compareRecent,
  countProviders,
  deriveSessionTitle,
  formatDate,
  prettyCategory,
  prettyProvider,
  sessionActivityOf,
  toErrorMessage,
  toggleValue,
} from "../lib/viewUtils";

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "-";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function scrollFocusedHistoryMessageIntoView(
  container: HTMLDivElement,
  messageElement: HTMLDivElement,
): void {
  const containerRect = container.getBoundingClientRect();
  const messageRect = messageElement.getBoundingClientRect();
  const containerHeight = container.clientHeight || containerRect.height;
  const messageHeight = messageRect.height;

  if (containerHeight > 0 && messageHeight > containerHeight) {
    const nextScrollTop = Math.max(0, container.scrollTop + (messageRect.top - containerRect.top));
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: nextScrollTop, behavior: "smooth" });
      return;
    }
    container.scrollTop = nextScrollTop;
    return;
  }

  messageElement.scrollIntoView({
    block: "center",
    behavior: "smooth",
  });
}

function focusHistoryList(container: HTMLDivElement | null): void {
  window.setTimeout(() => {
    container?.focus({ preventScroll: true });
  }, 0);
}

type AppearanceState = {
  theme: ThemeMode;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  monoFontFamily: MonoFontFamily;
  setMonoFontFamily: Dispatch<SetStateAction<MonoFontFamily>>;
  regularFontFamily: RegularFontFamily;
  setRegularFontFamily: Dispatch<SetStateAction<RegularFontFamily>>;
  monoFontSize: MonoFontSize;
  setMonoFontSize: Dispatch<SetStateAction<MonoFontSize>>;
  regularFontSize: RegularFontSize;
  setRegularFontSize: Dispatch<SetStateAction<RegularFontSize>>;
  useMonospaceForAllMessages: boolean;
  setUseMonospaceForAllMessages: Dispatch<SetStateAction<boolean>>;
};

export function useHistoryController({
  initialPaneState,
  isHistoryLayout,
  searchMode,
  searchProviders,
  setSearchProviders,
  appearance,
  logError,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  isHistoryLayout: boolean;
  searchMode: SearchMode;
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

  const loadProjects = useCallback(async () => {
    const requestToken = projectsLoadTokenRef.current + 1;
    projectsLoadTokenRef.current = requestToken;
    setProjectsLoaded(false);
    const response = await codetrail.invoke("projects:list", {
      providers: projectProviders.length > 0 ? projectProviders : undefined,
      query: projectQuery,
    });
    if (requestToken !== projectsLoadTokenRef.current) {
      return;
    }
    setProjects(response.projects);
    setProjectsLoaded(true);
    if (
      !pendingSearchNavigation &&
      response.projects.length > 0 &&
      !rawSelectedProjectId
    ) {
      setHistorySelection((selectionState) =>
        setHistorySelectionProjectId(selectionState, response.projects[0]?.id ?? ""),
      );
    }
  }, [codetrail, pendingSearchNavigation, projectProviders, projectQuery, rawSelectedProjectId]);

  const loadSessions = useCallback(async () => {
    const requestToken = sessionsLoadTokenRef.current + 1;
    sessionsLoadTokenRef.current = requestToken;
    if (!selectedProjectId) {
      if (requestToken !== sessionsLoadTokenRef.current) {
        return;
      }
      setSessions([]);
      setSessionsLoadedProjectId("");
      setHistorySelection((value) =>
        value.mode === "session" ? createHistorySelection("project_all", "", "") : value,
      );
      return;
    }

    setSessionsLoadedProjectId(null);
    const response = await codetrail.invoke("sessions:list", {
      projectId: selectedProjectId,
    });
    if (requestToken !== sessionsLoadTokenRef.current) {
      return;
    }
    setSessions(response.sessions);
    setSessionsLoadedProjectId(selectedProjectId);
  }, [codetrail, selectedProjectId]);

  const loadBookmarks = useCallback(async () => {
    const requestToken = bookmarksLoadTokenRef.current + 1;
    bookmarksLoadTokenRef.current = requestToken;
    if (!selectedProjectId) {
      if (requestToken !== bookmarksLoadTokenRef.current) {
        return;
      }
      setBookmarksResponse(EMPTY_BOOKMARKS_RESPONSE);
      setBookmarksLoadedProjectId("");
      return;
    }
    setBookmarksLoadedProjectId(null);
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const response = await codetrail.invoke("bookmarks:listProject", {
      projectId: selectedProjectId,
      query: effectiveBookmarkQuery,
      searchMode,
      categories: isAllHistoryCategoriesSelected ? undefined : historyCategories,
    });
    if (requestToken !== bookmarksLoadTokenRef.current) {
      return;
    }
    setBookmarksResponse(response);
    setBookmarksLoadedProjectId(selectedProjectId);
  }, [codetrail, effectiveBookmarkQuery, historyCategories, searchMode, selectedProjectId]);

  const paneStateForSync = useMemo(
    () => ({
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
      sessionSortDirection,
      systemMessageRegexRules,
    ],
  );

  const setSelectedProjectIdForPaneStateSync = useCallback(
    (value: SetStateAction<string>) => {
      setHistorySelection((selectionState) =>
        typeof value === "function"
          ? setHistorySelectionProjectId(selectionState, value(selectionState.projectId))
          : setHistorySelectionProjectId(selectionState, value),
      );
    },
    [],
  );

  const setSelectedSessionIdForPaneStateSync = useCallback(
    (value: SetStateAction<string>) => {
      setHistorySelection((selectionState) =>
        typeof value === "function"
          ? setHistorySelectionSessionId(
              selectionState,
              value(selectionState.mode === "session" ? selectionState.sessionId : ""),
            )
          : setHistorySelectionSessionId(selectionState, value),
      );
    },
    [],
  );

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
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

  useEffect(() => {
    return () => {
      if (sessionScrollSyncTimerRef.current !== null) {
        window.clearTimeout(sessionScrollSyncTimerRef.current);
      }
    };
  }, []);

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

    if (sortedProjects.length === 0) {
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
    sortedSessions,
  ]);

  useEffect(() => {
    if (!pendingSearchNavigation) {
      return;
    }

    if (pendingSearchNavigation.projectId !== selectedProjectId) {
      setHistorySelection((selectionState) =>
        setHistorySelectionProjectId(selectionState, pendingSearchNavigation.projectId),
      );
      return;
    }

    if (!sortedSessions.some((session) => session.id === pendingSearchNavigation.sessionId)) {
      return;
    }

    setHistorySelection({
      mode: "session",
      projectId: pendingSearchNavigation.projectId,
      sessionId: pendingSearchNavigation.sessionId,
    });
    setSessionQueryInput("");
    setHistoryCategories([...pendingSearchNavigation.historyCategories]);
    setSessionPage(0);
    setFocusMessageId(pendingSearchNavigation.messageId);
    setPendingRevealTarget({
      sourceId: pendingSearchNavigation.sourceId,
      messageId: pendingSearchNavigation.messageId,
    });
    setPendingSearchNavigation(null);
  }, [pendingSearchNavigation, selectedProjectId, sortedSessions]);

  useEffect(() => {
    if (historyMode !== "bookmarks" || bookmarksLoadedProjectId !== selectedProjectId) {
      return;
    }
    if (bookmarksResponse.totalCount > 0) {
      return;
    }
    setHistorySelection((selectionState) => createHistorySelection("project_all", selectionState.projectId));
  }, [bookmarksLoadedProjectId, bookmarksResponse.totalCount, historyMode, selectedProjectId]);

  useEffect(() => {
    if (historyMode !== "session" || !selectedSessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    const isRevealing = pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected ? undefined : historyCategories;
    const effectiveQuery = isRevealing ? "" : effectiveSessionQuery;
    void codetrail
      .invoke("sessions:getDetail", {
        sessionId: selectedSessionId,
        page: sessionPage,
        pageSize: PAGE_SIZE,
        categories: effectiveCategories,
        query: effectiveQuery,
        searchMode,
        sortDirection: messageSortDirection,
        focusMessageId: pendingRevealTarget?.messageId || undefined,
        focusSourceId: pendingRevealTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSessionDetail(response);
        if (pendingRevealTarget !== null) {
          setPendingRevealTarget(null);
        }
        if (response.page !== sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading session detail", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    effectiveSessionQuery,
    historyCategories,
    historyMode,
    logError,
    messageSortDirection,
    pendingRevealTarget,
    searchMode,
    selectedSessionId,
    sessionPage,
  ]);

  useEffect(() => {
    if (historyMode !== "project_all" || !selectedProjectId) {
      setProjectCombinedDetail(null);
      return;
    }

    let cancelled = false;
    const isRevealing = pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected ? undefined : historyCategories;
    const effectiveQuery = isRevealing ? "" : effectiveSessionQuery;
    void codetrail
      .invoke("projects:getCombinedDetail", {
        projectId: selectedProjectId,
        page: sessionPage,
        pageSize: PAGE_SIZE,
        categories: effectiveCategories,
        query: effectiveQuery,
        searchMode,
        sortDirection: projectAllSortDirection,
        focusMessageId: pendingRevealTarget?.messageId || undefined,
        focusSourceId: pendingRevealTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setProjectCombinedDetail(response);
        if (pendingRevealTarget !== null) {
          setPendingRevealTarget(null);
        }
        if (response.page !== sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading project combined detail", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    effectiveSessionQuery,
    historyCategories,
    historyMode,
    logError,
    pendingRevealTarget,
    projectAllSortDirection,
    searchMode,
    selectedProjectId,
    sessionPage,
  ]);

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
      ? "All Sessions messages"
      : historyMode === "bookmarks"
        ? "bookmarked messages"
        : "session messages";
  const messageSortTooltip =
    activeMessageSortDirection === "asc"
      ? `${messageSortScopeLabel}: oldest to newest. Click to switch to newest first.`
      : `${messageSortScopeLabel}: newest to oldest. Click to switch to oldest first.`;

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

  useEffect(() => {
    if (!selectedProjectId) {
      setSessionPaneStableProjectId(null);
      return;
    }
    if (
      sessionsLoadedProjectId === selectedProjectId &&
      bookmarksLoadedProjectId === selectedProjectId
    ) {
      setSessionPaneStableProjectId((value) =>
        value === selectedProjectId ? value : selectedProjectId,
      );
    }
  }, [bookmarksLoadedProjectId, selectedProjectId, sessionsLoadedProjectId]);

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
  const visibleSessionPaneSessions = isSessionPaneReadyForSelectedProject ? sortedSessions : [];
  const visibleSessionPaneBookmarksCount = isSessionPaneReadyForSelectedProject
    ? bookmarksResponse.totalCount
    : 0;
  const visibleSessionPaneAllSessionsCount = isSessionPaneReadyForSelectedProject
    ? allSessionsCount
    : 0;

  const sessionPaneNavigationItems = useMemo<SessionPaneNavigationItem[]>(() => {
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
    ? {
        gridTemplateColumns: `${
          projectPaneCollapsed ? COLLAPSED_PANE_WIDTH : projectPaneWidth
        }px 1px ${sessionPaneCollapsed ? COLLAPSED_PANE_WIDTH : sessionPaneWidth}px 1px minmax(420px, 1fr)`,
      }
    : undefined;

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
  }, [areScopedMessagesExpanded, scopedMessages]);

  const handleToggleHistoryCategoryShortcut = useCallback((category: MessageCategory) => {
    setHistoryCategories((value) => toggleValue<MessageCategory>(value, category));
    setSessionPage(0);
  }, []);

  const handleToggleMessageExpanded = useCallback(
    (messageId: string, category: MessageCategory) => {
      setMessageExpanded((value) => ({
        ...value,
        [messageId]: !(value[messageId] ?? isExpandedByDefault(category)),
      }));
    },
    [isExpandedByDefault],
  );

  const handleRevealInSession = useCallback(
    (messageId: string, sourceId: string) => {
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

  const handleMessageListScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    sessionScrollTopRef.current = Math.max(0, Math.round(event.currentTarget.scrollTop));
    if (sessionScrollSyncTimerRef.current !== null) {
      return;
    }
    sessionScrollSyncTimerRef.current = window.setTimeout(() => {
      sessionScrollSyncTimerRef.current = null;
      setSessionScrollTop((value) =>
        value === sessionScrollTopRef.current ? value : sessionScrollTopRef.current,
      );
    }, 120);
  }, []);

  const handleHistorySearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
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
  }, []);

  const resetHistorySelectionState = useCallback(() => {
    setPendingSearchNavigation(null);
    setPendingMessageAreaFocus(false);
    setPendingMessagePageNavigation(null);
    setSessionPage(0);
    setFocusMessageId("");
    setPendingRevealTarget(null);
  }, []);

  const selectProjectAllMessages = useCallback(
    (projectId: string) => {
      resetHistorySelectionState();
      setHistorySelection(createHistorySelection("project_all", projectId, ""));
    },
    [resetHistorySelectionState],
  );

  const selectBookmarksView = useCallback(() => {
    resetHistorySelectionState();
    setHistorySelection(createHistorySelection("bookmarks", selectedProjectId, ""));
  }, [resetHistorySelectionState, selectedProjectId]);

  const selectSessionView = useCallback(
    (sessionId: string) => {
      resetHistorySelectionState();
      setHistorySelection(createHistorySelection("session", selectedProjectId, sessionId));
    },
    [resetHistorySelectionState, selectedProjectId],
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
      selectBookmarksView,
      selectProjectAllMessages,
      selectSessionView,
      selectedProjectId,
      selectedSessionId,
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
    [selectProjectAllMessages, selectedProjectId, sortedProjects],
  );

  const goToPreviousHistoryPage = useCallback(() => {
    if (!canNavigatePages) {
      return;
    }
    setSessionPage((value) => Math.max(0, value - 1));
  }, [canNavigatePages]);

  const goToNextHistoryPage = useCallback(() => {
    if (!canNavigatePages) {
      return;
    }
    setSessionPage((value) => Math.min(totalPages - 1, value + 1));
  }, [canNavigatePages, totalPages]);

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
      setPendingMessageAreaFocus(true);
      setPendingMessagePageNavigation({ direction, targetPage });
      setSessionPage(targetPage);
    },
    [
      activeHistoryMessages,
      canGoToNextHistoryPage,
      canGoToPreviousHistoryPage,
      sessionPage,
      totalPages,
      visibleFocusedMessageId,
    ],
  );

  const handleCopySessionDetails = useCallback(async () => {
    if (!selectedSession) {
      return;
    }
    const messageCount = sessionDetail?.totalCount ?? selectedSession.messageCount;
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
  }, [logError, selectedProject, selectedSession, sessionDetail?.totalCount, sessionPage]);

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
  }, [allSessionsCount, logError, selectedProject]);

  const focusSessionSearch = useCallback(() => {
    window.setTimeout(() => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    }, 0);
  }, []);

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
    [],
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
    selectedSummaryProvider:
      historyMode === "session"
        ? selectedSession?.provider ?? null
        : selectedProject?.provider ?? null,
    selectedSummaryMessageCount:
      historyMode === "bookmarks"
        ? `${bookmarksResponse.filteredCount} of ${bookmarksResponse.totalCount} bookmarked messages`
        : historyMode === "project_all"
          ? `${projectCombinedDetail?.totalCount ?? 0} messages`
          : `${sessionDetail?.totalCount ?? 0} messages`,
    selectedTitle:
      historyMode === "bookmarks"
        ? "Bookmarks"
        : historyMode === "project_all"
          ? "All Sessions"
          : selectedSession
            ? deriveSessionTitle(selectedSession)
            : "Session Detail",
    selectedProviderLabel:
      historyMode === "session"
        ? selectedSession
          ? prettyProvider(selectedSession.provider)
          : "-"
        : selectedProject
          ? prettyProvider(selectedProject.provider)
          : "-",
    historyCategoriesShortcutMap: HISTORY_CATEGORY_SHORTCUTS,
    prettyCategory,
    prettyProvider,
    formatDate,
    handleRefreshAllData: handleRefresh,
  };
}
