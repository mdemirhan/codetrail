import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { MessageCategory, Provider } from "@codetrail/core";
import type { IpcResponse } from "@codetrail/core";

import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { TopBar } from "./components/TopBar";
import { ProjectPane } from "./components/history/ProjectPane";
import { SessionPane } from "./components/history/SessionPane";
import {
  HighlightedText,
  MessageCard,
  isMessageExpandedByDefault,
} from "./components/messages/MessagePresentation";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { openInFileManager, openPath } from "./lib/pathActions";
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
} from "./lib/viewUtils";

type ProjectSummary = IpcResponse<"projects:list">["projects"][number];
type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];
type SessionDetail = IpcResponse<"sessions:getDetail">;
type SearchQueryResponse = IpcResponse<"search:query">;

const PAGE_SIZE = 100;

const PROVIDERS: Provider[] = ["claude", "codex", "gemini"];
const CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];
const DEFAULT_MESSAGE_CATEGORIES: MessageCategory[] = ["user", "assistant"];
const EMPTY_CATEGORY_COUNTS = {
  user: 0,
  assistant: 0,
  tool_use: 0,
  tool_edit: 0,
  tool_result: 0,
  thinking: 0,
  system: 0,
};

type MainView = "history" | "search";
type ThemeMode = "light" | "dark";

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

export function App() {
  const [refreshing, setRefreshing] = useState(false);

  const [mainView, setMainView] = useState<MainView>("history");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [focusMode, setFocusMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [projectQueryInput, setProjectQueryInput] = useState("");
  const [projectProviders, setProjectProviders] = useState<Provider[]>([...PROVIDERS]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoadedProjectId, setSessionsLoadedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionScrollTop, setSessionScrollTop] = useState(0);
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>([
    ...DEFAULT_MESSAGE_CATEGORIES,
  ]);
  const [messageExpanded, setMessageExpanded] = useState<Record<string, boolean>>({});
  const [zoomPercent, setZoomPercent] = useState(100);
  const [focusSourceId, setFocusSourceId] = useState("");
  const [pendingJumpTarget, setPendingJumpTarget] = useState<{
    sourceId: string;
    messageId: string;
  } | null>(null);
  const [pendingSearchNavigation, setPendingSearchNavigation] = useState<{
    projectId: string;
    sessionId: string;
    sourceId: string;
  } | null>(null);

  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchProjectQueryInput, setSearchProjectQueryInput] = useState("");
  const [searchProviders, setSearchProviders] = useState<Provider[]>([]);
  const [searchCategories, setSearchCategories] = useState<MessageCategory[]>([
    ...DEFAULT_MESSAGE_CATEGORIES,
  ]);
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchResponse, setSearchResponse] = useState<SearchQueryResponse>({
    query: "",
    totalCount: 0,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
    results: [],
  });

  const [projectPaneWidth, setProjectPaneWidth] = useState(300);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(320);
  const [paneStateHydrated, setPaneStateHydrated] = useState(false);
  const resizeState = useRef<{
    pane: "project" | "session";
    startX: number;
    projectPaneWidth: number;
    sessionPaneWidth: number;
  } | null>(null);

  const projectQuery = useDebouncedValue(projectQueryInput, 180);
  const sessionQuery = useDebouncedValue(sessionQueryInput, 180);
  const searchQuery = useDebouncedValue(searchQueryInput, 220);
  const searchProjectQuery = useDebouncedValue(searchProjectQueryInput, 180);
  const effectiveSessionQuery = sessionQueryInput.trim().length === 0 ? "" : sessionQuery;
  const logError = useCallback((context: string, error: unknown) => {
    console.error(`[codetrail] ${context}: ${toErrorMessage(error)}`);
  }, []);

  const focusedMessageRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRestoredSessionScrollRef = useRef<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>(null);
  const sessionScrollTopRef = useRef(0);
  const sessionScrollSyncTimerRef = useRef<number | null>(null);
  const sortedProjects = useMemo(() => {
    const next = [...projects];
    next.sort((left, right) => {
      return (
        compareRecent(right.lastActivity, left.lastActivity) || left.name.localeCompare(right.name)
      );
    });
    return next;
  }, [projects]);

  const sortedSessions = useMemo(() => {
    const next = [...sessions];
    next.sort((left, right) => {
      return (
        compareRecent(sessionActivityOf(right), sessionActivityOf(left)) ||
        right.messageCount - left.messageCount
      );
    });
    return next;
  }, [sessions]);

  const loadProjects = useCallback(async () => {
    setProjectsLoaded(false);
    const response = await window.codetrail.invoke("projects:list", {
      providers: projectProviders,
      query: projectQuery,
    });
    setProjects(response.projects);
    setProjectsLoaded(true);
  }, [projectProviders, projectQuery]);

  const loadSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions([]);
      setSessionsLoadedProjectId("");
      setSelectedSessionId("");
      return;
    }

    setSessionsLoadedProjectId(null);
    const response = await window.codetrail.invoke("sessions:list", {
      projectId: selectedProjectId,
    });
    setSessions(response.sessions);
    setSessionsLoadedProjectId(selectedProjectId);
  }, [selectedProjectId]);

  const loadSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    const isAllSearchCategoriesSelected = searchCategories.length === CATEGORIES.length;
    if (trimmed.length === 0) {
      setSearchResponse({
        query: searchQuery,
        totalCount: 0,
        categoryCounts: EMPTY_CATEGORY_COUNTS,
        results: [],
      });
      return;
    }

    const response = await window.codetrail.invoke("search:query", {
      query: searchQuery,
      categories: isAllSearchCategoriesSelected ? undefined : searchCategories,
      providers: searchProviders.length > 0 ? searchProviders : undefined,
      projectIds: searchProjectId ? [searchProjectId] : undefined,
      projectQuery: searchProjectQuery,
      limit: 100,
      offset: 0,
    });
    setSearchResponse(response);
  }, [searchCategories, searchProjectId, searchProjectQuery, searchProviders, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    void window.codetrail
      .invoke("ui:getState", {})
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.projectPaneWidth !== null) {
          setProjectPaneWidth(clamp(response.projectPaneWidth, 230, 520));
        }
        if (response.sessionPaneWidth !== null) {
          setSessionPaneWidth(clamp(response.sessionPaneWidth, 250, 620));
        }
        if (response.projectProviders !== null) {
          setProjectProviders(response.projectProviders);
        }
        if (response.historyCategories !== null) {
          setHistoryCategories(response.historyCategories);
        }
        if (response.searchProviders !== null) {
          setSearchProviders(response.searchProviders);
        }
        if (response.searchCategories !== null) {
          setSearchCategories(response.searchCategories);
        }
        if (response.theme !== null) {
          setTheme(response.theme);
        }
        if (response.selectedProjectId !== null) {
          setSelectedProjectId(response.selectedProjectId);
        }
        if (response.selectedSessionId !== null) {
          setSelectedSessionId(response.selectedSessionId);
        }
        if (response.sessionPage !== null) {
          setSessionPage(response.sessionPage);
        }
        if (response.sessionScrollTop !== null) {
          sessionScrollTopRef.current = response.sessionScrollTop;
          setSessionScrollTop(response.sessionScrollTop);
        }
        if (
          response.selectedSessionId !== null &&
          response.sessionPage !== null &&
          response.sessionScrollTop !== null &&
          response.sessionScrollTop > 0
        ) {
          pendingRestoredSessionScrollRef.current = {
            sessionId: response.selectedSessionId,
            sessionPage: response.sessionPage,
            scrollTop: response.sessionScrollTop,
          };
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading UI state", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPaneStateHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [logError]);

  useEffect(() => {
    let cancelled = false;
    void window.codetrail
      .invoke("ui:getZoom", {})
      .then((response) => {
        if (!cancelled) {
          setZoomPercent(response.percent);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading zoom state", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [logError]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!paneStateHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      void window.codetrail
        .invoke("ui:setState", {
          projectPaneWidth: Math.round(projectPaneWidth),
          sessionPaneWidth: Math.round(sessionPaneWidth),
          projectProviders,
          historyCategories,
          searchProviders,
          searchCategories,
          theme,
          selectedProjectId,
          selectedSessionId,
          sessionPage,
          sessionScrollTop,
        })
        .catch((error: unknown) => {
          logError("Failed saving UI state", error);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    historyCategories,
    logError,
    paneStateHydrated,
    projectPaneWidth,
    projectProviders,
    searchCategories,
    searchProviders,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    sessionScrollTop,
    sessionPaneWidth,
    theme,
  ]);

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
        setSelectedProjectId("");
      }
      setSearchProjectId("");
      return;
    }

    if (
      !pendingSearchNavigation &&
      !sortedProjects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(sortedProjects[0]?.id ?? "");
    }

    if (searchProjectId && !sortedProjects.some((project) => project.id === searchProjectId)) {
      setSearchProjectId("");
    }
  }, [pendingSearchNavigation, projectsLoaded, searchProjectId, selectedProjectId, sortedProjects]);

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
    if (sessionsLoadedProjectId !== selectedProjectId) {
      return;
    }

    if (sortedSessions.length === 0) {
      if (!pendingSearchNavigation) {
        setSelectedSessionId("");
      }
      return;
    }

    if (pendingSearchNavigation) {
      return;
    }

    if (!selectedSessionId || !sortedSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sortedSessions[0]?.id ?? "");
      setSessionPage(0);
    }
  }, [
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
      setSelectedProjectId(pendingSearchNavigation.projectId);
      return;
    }

    if (!sortedSessions.some((session) => session.id === pendingSearchNavigation.sessionId)) {
      return;
    }

    setSelectedSessionId(pendingSearchNavigation.sessionId);
    setSessionQueryInput("");
    setHistoryCategories([...CATEGORIES]);
    setSessionPage(0);
    setFocusSourceId(pendingSearchNavigation.sourceId);
    setPendingJumpTarget({
      sourceId: pendingSearchNavigation.sourceId,
      messageId: "",
    });
    setPendingSearchNavigation(null);
    setMainView("history");
  }, [pendingSearchNavigation, selectedProjectId, sortedSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    const isJumping = pendingJumpTarget !== null;
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected ? undefined : historyCategories;
    const effectiveQuery = isJumping ? "" : effectiveSessionQuery;
    void window.codetrail
      .invoke("sessions:getDetail", {
        sessionId: selectedSessionId,
        page: sessionPage,
        pageSize: PAGE_SIZE,
        categories: effectiveCategories,
        query: effectiveQuery,
        focusMessageId: pendingJumpTarget?.messageId || undefined,
        focusSourceId: pendingJumpTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSessionDetail(response);
        if (pendingJumpTarget !== null) {
          setPendingJumpTarget(null);
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
    selectedSessionId,
    sessionPage,
    historyCategories,
    effectiveSessionQuery,
    pendingJumpTarget,
    logError,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadSearch().catch((error: unknown) => {
      if (!cancelled) {
        logError("Search failed", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSearch, logError]);

  const focusedMessageId = useMemo(() => {
    if (!focusSourceId || !sessionDetail?.messages) {
      return "";
    }
    return sessionDetail.messages.find((message) => message.sourceId === focusSourceId)?.id ?? "";
  }, [focusSourceId, sessionDetail?.messages]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }
    if (!selectedSessionId || sessionPage < 0) {
      messageListRef.current.scrollTop = 0;
      sessionScrollTopRef.current = 0;
      setSessionScrollTop(0);
      return;
    }

    const pendingRestore = pendingRestoredSessionScrollRef.current;
    if (
      pendingRestore &&
      pendingRestore.sessionId === selectedSessionId &&
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
  }, [selectedSessionId, sessionPage]);

  useEffect(() => {
    if (!focusSourceId || !focusedMessageId || !focusedMessageRef.current) {
      return;
    }

    focusedMessageRef.current.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [focusSourceId, focusedMessageId]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeState.current;
      if (!active) {
        return;
      }

      const delta = event.clientX - active.startX;
      if (active.pane === "project") {
        setProjectPaneWidth(clamp(active.projectPaneWidth + delta, 230, 520));
        return;
      }

      setSessionPaneWidth(clamp(active.sessionPaneWidth + delta, 250, 620));
    };

    const onPointerUp = () => {
      resizeState.current = null;
      document.body.classList.remove("resizing-panels");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const handleRefresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      try {
        await window.codetrail.invoke("indexer:refresh", { force });
        await Promise.all([loadProjects(), loadSessions(), loadSearch()]);
      } catch (error) {
        logError("Refresh failed", error);
      } finally {
        setRefreshing(false);
      }
    },
    [loadProjects, loadSearch, loadSessions, logError],
  );

  const handleIncrementalRefresh = useCallback(async () => {
    await handleRefresh(false);
  }, [handleRefresh]);

  const handleForceRefresh = useCallback(async () => {
    await handleRefresh(true);
  }, [handleRefresh]);

  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, sortedProjects],
  );
  const selectedSession = useMemo(
    () => sortedSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sortedSessions],
  );

  const applyZoomAction = useCallback(
    async (action: "in" | "out" | "reset") => {
      try {
        const response = await window.codetrail.invoke("ui:setZoom", { action });
        setZoomPercent(response.percent);
      } catch (error) {
        logError(`Failed applying zoom action '${action}'`, error);
      }
    },
    [logError],
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
    const sessionDetailsText = lines.join("\n");
    try {
      await navigator.clipboard.writeText(sessionDetailsText);
      return;
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = sessionDetailsText;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.left = "-9999px";
      document.body.appendChild(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(fallback);
      if (!copied) {
        logError("Failed copying session details", "Clipboard API unavailable");
      }
    }
  }, [logError, selectedProject, selectedSession, sessionDetail?.totalCount, sessionPage]);

  const focusSessionSearch = useCallback(() => {
    setMainView("history");
    window.setTimeout(() => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    }, 0);
  }, []);

  const focusGlobalSearch = useCallback(() => {
    setMainView("search");
    window.setTimeout(() => {
      globalSearchInputRef.current?.focus();
      globalSearchInputRef.current?.select();
    }, 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      if (event.key === "?") {
        setShowShortcuts(true);
      } else if (event.key === "Escape") {
        if (showShortcuts) {
          event.preventDefault();
          setShowShortcuts(false);
        } else if (mainView === "search") {
          event.preventDefault();
          setMainView("history");
        }
      } else if (command && shift && key === "f") {
        event.preventDefault();
        focusGlobalSearch();
      } else if (command && key === "f") {
        event.preventDefault();
        focusSessionSearch();
      } else if (command && event.key === "1") {
        event.preventDefault();
        setMainView("history");
      } else if (command && event.key === "2") {
        event.preventDefault();
        setMainView("search");
      } else if (command && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        void applyZoomAction("in");
      } else if (command && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        void applyZoomAction("out");
      } else if (command && event.key === "0") {
        event.preventDefault();
        void applyZoomAction("reset");
      } else if (command && shift && key === "r") {
        event.preventDefault();
        void handleForceRefresh();
      } else if (command && key === "r") {
        event.preventDefault();
        void handleIncrementalRefresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    applyZoomAction,
    focusGlobalSearch,
    focusSessionSearch,
    handleForceRefresh,
    handleIncrementalRefresh,
    mainView,
    showShortcuts,
  ]);

  const projectProviderCounts = useMemo(
    () => countProviders(sortedProjects.map((project) => project.provider)),
    [sortedProjects],
  );
  const searchProviderCounts = useMemo(
    () => countProviders(searchResponse.results.map((result) => result.provider)),
    [searchResponse.results],
  );

  const totalPages = useMemo(() => {
    const totalCount = sessionDetail?.totalCount ?? 0;
    if (totalCount === 0) {
      return 1;
    }
    return Math.ceil(totalCount / PAGE_SIZE);
  }, [sessionDetail?.totalCount]);

  const canZoomIn = zoomPercent < 500;
  const canZoomOut = zoomPercent > 25;
  const historyCategoryCounts = sessionDetail?.categoryCounts ?? EMPTY_CATEGORY_COUNTS;
  const isHistoryLayout = mainView === "history" && !focusMode;
  const sessionMessages = sessionDetail?.messages ?? [];
  const areAllMessagesExpanded = useMemo(
    () =>
      sessionMessages.length > 0 &&
      sessionMessages.every(
        (message) => messageExpanded[message.id] ?? isMessageExpandedByDefault(message.category),
      ),
    [messageExpanded, sessionMessages],
  );
  const workspaceStyle = isHistoryLayout
    ? {
        gridTemplateColumns: `${projectPaneWidth}px 1px ${sessionPaneWidth}px 1px minmax(420px, 1fr)`,
      }
    : undefined;

  const shortcutItems = useMemo(() => {
    const global = [
      "Cmd/Ctrl+1: History view",
      "Cmd/Ctrl+2: Search view",
      "Cmd/Ctrl+F: Focus session search",
      "Cmd/Ctrl+Shift+F: Open global search",
      "Cmd/Ctrl+R: Refresh index",
      "Cmd/Ctrl+Shift+R: Force reindex",
      "Toolbar: Reindex and Copy session",
      "?: Shortcut help",
      "Esc: Close shortcuts",
    ];
    const contextual =
      mainView === "history"
        ? ["Current view: History", `Selected session: ${selectedSession ? "yes" : "none"}`]
        : ["Current view: Search", `Results: ${searchResponse.totalCount}`];
    return [...contextual, ...global];
  }, [mainView, searchResponse.totalCount, selectedSession]);

  const handleSetAllMessagesExpanded = useCallback(
    (expanded: boolean) => {
      if (sessionMessages.length === 0) {
        return;
      }
      setMessageExpanded((value) => {
        const next = { ...value };
        for (const message of sessionMessages) {
          next[message.id] = expanded;
        }
        return next;
      });
    },
    [sessionMessages],
  );

  const handleJumpToMessage = useCallback((messageId: string, sourceId: string) => {
    setSessionQueryInput("");
    setSessionPage(0);
    setFocusSourceId(sourceId);
    setPendingJumpTarget({ messageId, sourceId });
  }, []);

  const beginResize =
    (pane: "project" | "session") => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isHistoryLayout) {
        return;
      }
      event.preventDefault();
      resizeState.current = {
        pane,
        startX: event.clientX,
        projectPaneWidth,
        sessionPaneWidth,
      };
      document.body.classList.add("resizing-panels");
    };

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

  const handleSessionSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    const focusTarget =
      messageListRef.current?.querySelector<HTMLButtonElement>(
        ".message.focused .message-select-button",
      ) ??
      messageListRef.current?.querySelector<HTMLButtonElement>(".message .message-select-button") ??
      messageListRef.current?.querySelector<HTMLButtonElement>(".message .msg-role");
    focusTarget?.focus();
  }, []);

  return (
    <main className="app-shell">
      <TopBar
        mainView={mainView}
        theme={theme}
        refreshing={refreshing}
        focusMode={focusMode}
        focusDisabled={mainView !== "history"}
        copyDisabled={!selectedSession || mainView !== "history"}
        onToggleSearchView={() =>
          setMainView((value) => (value === "history" ? "search" : "history"))
        }
        onThemeChange={setTheme}
        onIncrementalRefresh={() => void handleIncrementalRefresh()}
        onForceRefresh={() => void handleForceRefresh()}
        onCopySession={() => void handleCopySessionDetails()}
        onToggleFocus={() => setFocusMode((value) => !value)}
        onToggleShortcuts={() => setShowShortcuts((value) => !value)}
      />

      <div
        className={`workspace ${isHistoryLayout ? "history-layout" : "single-layout"} ${mainView === "search" ? "search-layout" : ""}`}
        style={workspaceStyle}
      >
        {isHistoryLayout ? (
          <>
            <ProjectPane
              sortedProjects={sortedProjects}
              selectedProjectId={selectedProjectId}
              projectQueryInput={projectQueryInput}
              projectProviders={projectProviders}
              providers={PROVIDERS}
              projectProviderCounts={projectProviderCounts}
              onProjectQueryChange={setProjectQueryInput}
              onToggleProvider={(provider) =>
                setProjectProviders((value) => toggleValue(value, provider))
              }
              onSelectProject={(projectId) => {
                setPendingSearchNavigation(null);
                setSelectedProjectId(projectId);
                setFocusSourceId("");
                setPendingJumpTarget(null);
              }}
              onOpenProjectLocation={() => {
                void openInFileManager(sortedProjects, selectedProjectId).then((result) => {
                  if (!result.ok) {
                    logError("Failed opening project location", result.error ?? "Unknown error");
                  }
                });
              }}
              canOpenSessionLocation={!!selectedSession}
              onOpenSessionLocation={() => {
                if (!selectedSession) {
                  return;
                }
                void openPath(selectedSession.filePath).then((result) => {
                  if (!result.ok) {
                    logError("Failed opening session location", result.error ?? "Unknown error");
                  }
                });
              }}
            />

            <div className="pane-resizer" onPointerDown={beginResize("project")} />

            <SessionPane
              sortedSessions={sortedSessions}
              selectedSessionId={selectedSessionId}
              onSelectSession={(sessionId) => {
                setPendingSearchNavigation(null);
                setSelectedSessionId(sessionId);
                setSessionPage(0);
                setFocusSourceId("");
                setPendingJumpTarget(null);
                setMainView("history");
              }}
            />

            <div className="pane-resizer" onPointerDown={beginResize("session")} />
          </>
        ) : null}

        <section className="pane content-pane">
          {mainView === "history" ? (
            <div className="history-view">
              <div className="msg-header">
                <div className="msg-header-top">
                  <div className="msg-header-title">
                    {selectedSession ? deriveSessionTitle(selectedSession) : "Session Detail"}
                  </div>
                  <div className="msg-toolbar">
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() => handleSetAllMessagesExpanded(!areAllMessagesExpanded)}
                      disabled={sessionMessages.length === 0}
                      aria-label={
                        areAllMessagesExpanded ? "Collapse all messages" : "Expand all messages"
                      }
                      title={
                        areAllMessagesExpanded ? "Collapse all messages" : "Expand all messages"
                      }
                    >
                      <ToolbarIcon name={areAllMessagesExpanded ? "collapseAll" : "expandAll"} />
                      {areAllMessagesExpanded ? "Collapse All" : "Expand All"}
                    </button>
                    <div className="toolbar-zoom-group">
                      <button
                        type="button"
                        className="toolbar-btn zoom-btn"
                        onClick={() => void applyZoomAction("out")}
                        disabled={!canZoomOut}
                        aria-label="Zoom out"
                        title="Zoom out"
                      >
                        <ToolbarIcon name="zoomOut" />
                      </button>
                      <span className="zoom-level" title="Current zoom level">
                        {zoomPercent}%
                      </span>
                      <button
                        type="button"
                        className="toolbar-btn zoom-btn"
                        onClick={() => void applyZoomAction("in")}
                        disabled={!canZoomIn}
                        aria-label="Zoom in"
                        title="Zoom in"
                      >
                        <ToolbarIcon name="zoomIn" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="msg-header-info">
                  <span className="provider">
                    {selectedSession ? prettyProvider(selectedSession.provider) : "-"}
                  </span>
                  <span>{selectedSession?.messageCount ?? 0} messages</span>
                </div>
              </div>

              <div className="msg-filters">
                {CATEGORIES.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`msg-filter ${category}-filter${
                      historyCategories.includes(category) ? " active" : ""
                    }`}
                    onClick={() => {
                      setHistoryCategories((value) =>
                        toggleValue<MessageCategory>(value, category),
                      );
                      setSessionPage(0);
                    }}
                  >
                    {prettyCategory(category)}
                    <span className="filter-count">{historyCategoryCounts[category]}</span>
                  </button>
                ))}
              </div>

              <div className="msg-search">
                <div className="search-box">
                  <ToolbarIcon name="search" />
                  <input
                    ref={sessionSearchInputRef}
                    className="search-input"
                    value={sessionQueryInput}
                    onKeyDown={handleSessionSearchKeyDown}
                    onChange={(event) => {
                      setSessionQueryInput(event.target.value);
                      setSessionPage(0);
                    }}
                    placeholder="Search in session..."
                  />
                </div>
              </div>

              <div
                className="msg-scroll message-list"
                ref={messageListRef}
                onScroll={handleMessageListScroll}
              >
                {sessionDetail?.messages.length ? (
                  sessionDetail.messages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      query={effectiveSessionQuery}
                      isFocused={!!focusSourceId && message.sourceId === focusSourceId}
                      isExpanded={
                        messageExpanded[message.id] ?? isMessageExpandedByDefault(message.category)
                      }
                      onToggleExpanded={() =>
                        setMessageExpanded((value) => ({
                          ...value,
                          [message.id]: !(
                            value[message.id] ?? isMessageExpandedByDefault(message.category)
                          ),
                        }))
                      }
                      onToggleFocused={() =>
                        setFocusSourceId((value) =>
                          value === message.sourceId ? "" : message.sourceId,
                        )
                      }
                      onJumpToMessage={() => handleJumpToMessage(message.id, message.sourceId)}
                      cardRef={
                        focusSourceId && message.sourceId === focusSourceId
                          ? focusedMessageRef
                          : null
                      }
                    />
                  ))
                ) : (
                  <p className="empty-state">No messages match current filters.</p>
                )}
              </div>

              <div className="msg-pagination pagination-row">
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => setSessionPage((value) => Math.max(0, value - 1))}
                  disabled={sessionPage <= 0}
                >
                  Previous
                </button>
                <span className="page-info">
                  Page {sessionPage + 1} / {totalPages} ({sessionDetail?.totalCount ?? 0} messages)
                </span>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => setSessionPage((value) => Math.min(totalPages - 1, value + 1))}
                  disabled={sessionPage + 1 >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <div className="search-view">
              <div className="content-head">
                <h2>Global Search</h2>
                <p>{searchResponse.totalCount} matches</p>
              </div>
              <div className="search-controls">
                <input
                  ref={globalSearchInputRef}
                  value={searchQueryInput}
                  onChange={(event) => setSearchQueryInput(event.target.value)}
                  placeholder="Search all message text"
                />
                <input
                  value={searchProjectQueryInput}
                  onChange={(event) => setSearchProjectQueryInput(event.target.value)}
                  placeholder="Filter by project text"
                />
                <select
                  className="search-select"
                  value={searchProjectId}
                  onChange={(event) => setSearchProjectId(event.target.value)}
                >
                  <option value="">All projects</option>
                  {sortedProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {prettyProvider(project.provider)}:{" "}
                      {project.name || project.path || "(unknown project)"}
                    </option>
                  ))}
                </select>
                <div className="chip-row">
                  {PROVIDERS.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      className={`chip provider-chip provider-${provider}${
                        searchProviders.includes(provider) ? " active" : ""
                      }`}
                      onClick={() => setSearchProviders((value) => toggleValue(value, provider))}
                    >
                      {prettyProvider(provider)} ({searchProviderCounts[provider]})
                    </button>
                  ))}
                </div>
                <div className="chip-row">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`chip category-chip category-${category}${
                        searchCategories.includes(category) ? " active" : ""
                      }`}
                      onClick={() =>
                        setSearchCategories((value) =>
                          toggleValue<MessageCategory>(value, category),
                        )
                      }
                    >
                      {prettyCategory(category)} ({searchResponse.categoryCounts[category]})
                    </button>
                  ))}
                </div>
              </div>

              <div className="search-result-list">
                {searchResponse.results.length === 0 ? (
                  <p className="empty-state">No search results.</p>
                ) : (
                  searchResponse.results.map((result) => (
                    <button
                      type="button"
                      key={result.messageId}
                      className={`search-result category-${result.category}`}
                      onClick={() => {
                        setProjectProviders([...PROVIDERS]);
                        setProjectQueryInput("");
                        setPendingSearchNavigation({
                          projectId: result.projectId,
                          sessionId: result.sessionId,
                          sourceId: result.messageSourceId,
                        });
                        setSelectedProjectId(result.projectId);
                        setMainView("history");
                      }}
                    >
                      <header>
                        <span className={`category-badge category-${result.category}`}>
                          {prettyCategory(result.category)}
                        </span>
                        <small>
                          <span className={`provider-label provider-${result.provider}`}>
                            {prettyProvider(result.provider)}
                          </span>{" "}
                          | {formatDate(result.createdAt)}
                        </small>
                      </header>
                      <p className="snippet">
                        <HighlightedText text={result.snippet} query="" allowMarks />
                      </p>
                      <footer>
                        <small>
                          {result.projectName || result.projectPath || "(unknown project)"}
                        </small>
                      </footer>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {showShortcuts ? (
        <ShortcutsDialog shortcutItems={shortcutItems} onClose={() => setShowShortcuts(false)} />
      ) : null}
    </main>
  );
}
