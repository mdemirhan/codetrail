import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent as ReactUIEvent } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { MessageCategory, Provider } from "@codetrail/core";
import type { IpcResponse } from "@codetrail/core";

import {
  type MonoFontFamily,
  type MonoFontSize,
  type RegularFontFamily,
  type RegularFontSize,
  type ThemeMode,
  UI_MESSAGE_CATEGORY_VALUES,
  UI_PROVIDER_VALUES,
} from "../shared/uiPreferences";
import { SettingsView } from "./components/SettingsView";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { TopBar } from "./components/TopBar";
import { ProjectPane } from "./components/history/ProjectPane";
import { SessionPane } from "./components/history/SessionPane";
import { HighlightedText, MessageCard } from "./components/messages/MessagePresentation";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePaneStateSync } from "./hooks/usePaneStateSync";
import { useResizablePanes } from "./hooks/useResizablePanes";
import { copyTextToClipboard } from "./lib/clipboard";
import { openInFileManager, openPath } from "./lib/pathActions";
import {
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
type SettingsInfoResponse = IpcResponse<"app:getSettingsInfo">;

const PAGE_SIZE = 100;
const COLLAPSED_PANE_WIDTH = 48;

const PROVIDERS: Provider[] = [...UI_PROVIDER_VALUES];
const CATEGORIES: MessageCategory[] = [...UI_MESSAGE_CATEGORY_VALUES];
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

type MainView = "history" | "search" | "settings";
type BulkExpandScope = "all" | MessageCategory;

const MONO_FONT_STACKS: Record<MonoFontFamily, string> = {
  current: '"JetBrains Mono", "IBM Plex Mono", monospace',
  droid_sans_mono: '"Droid Sans Mono", "JetBrains Mono", "IBM Plex Mono", monospace',
};

const REGULAR_FONT_STACKS: Record<RegularFontFamily, string> = {
  current: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  inter: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

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
  const [monoFontFamily, setMonoFontFamily] = useState<MonoFontFamily>("droid_sans_mono");
  const [regularFontFamily, setRegularFontFamily] = useState<RegularFontFamily>("current");
  const [monoFontSize, setMonoFontSize] = useState<MonoFontSize>("12px");
  const [regularFontSize, setRegularFontSize] = useState<RegularFontSize>("13.5px");
  const [useMonospaceForAllMessages, setUseMonospaceForAllMessages] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [projectPaneCollapsed, setProjectPaneCollapsed] = useState(false);
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isHistoryLayout = mainView === "history" && !focusMode;

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
  const [expandedByDefaultCategories, setExpandedByDefaultCategories] = useState<MessageCategory[]>(
    [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const [bulkExpandScope, setBulkExpandScope] = useState<BulkExpandScope>("all");
  const [messageExpanded, setMessageExpanded] = useState<Record<string, boolean>>({});
  const [zoomPercent, setZoomPercent] = useState(100);
  const [focusMessageId, setFocusMessageId] = useState("");
  const [pendingRevealTarget, setPendingRevealTarget] = useState<{
    sourceId: string;
    messageId: string;
  } | null>(null);
  const [pendingSearchNavigation, setPendingSearchNavigation] = useState<{
    projectId: string;
    sessionId: string;
    messageId: string;
    sourceId: string;
    historyCategories: MessageCategory[];
  } | null>(null);

  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchProjectQueryInput, setSearchProjectQueryInput] = useState("");
  const [searchProviders, setSearchProviders] = useState<Provider[]>([]);
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchResponse, setSearchResponse] = useState<SearchQueryResponse>({
    query: "",
    totalCount: 0,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
    results: [],
  });
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfoResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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
  });
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
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
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
      categories: isAllHistoryCategoriesSelected ? undefined : historyCategories,
      providers: searchProviders.length > 0 ? searchProviders : undefined,
      projectIds: searchProjectId ? [searchProjectId] : undefined,
      projectQuery: searchProjectQuery,
      limit: 100,
      offset: 0,
    });
    setSearchResponse(response);
  }, [historyCategories, searchProjectId, searchProjectQuery, searchProviders, searchQuery]);

  const loadSettingsInfo = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await window.codetrail.invoke("app:getSettingsInfo", {});
      setSettingsInfo(response);
    } catch (error) {
      setSettingsError(toErrorMessage(error));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const { paneStateHydrated } = usePaneStateSync({
    logError,
    projectPaneWidth,
    sessionPaneWidth,
    projectProviders,
    historyCategories,
    expandedByDefaultCategories,
    searchProviders,
    theme,
    monoFontFamily,
    regularFontFamily,
    monoFontSize,
    regularFontSize,
    useMonospaceForAllMessages,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    sessionScrollTop,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setUseMonospaceForAllMessages,
    setSelectedProjectId,
    setSelectedSessionId,
    setSessionPage,
    setSessionScrollTop,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

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
    document.documentElement.style.setProperty("--font-mono", MONO_FONT_STACKS[monoFontFamily]);
  }, [monoFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-sans",
      REGULAR_FONT_STACKS[regularFontFamily],
    );
  }, [regularFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty("--message-mono-font-size", monoFontSize);
  }, [monoFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty("--message-font-size", regularFontSize);
  }, [regularFontSize]);

  useEffect(() => {
    document.documentElement.dataset.useMonospaceMessages = useMonospaceForAllMessages
      ? "true"
      : "false";
  }, [useMonospaceForAllMessages]);

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
    if (!paneStateHydrated) {
      return;
    }

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
  }, [
    paneStateHydrated,
    pendingSearchNavigation,
    projectsLoaded,
    searchProjectId,
    selectedProjectId,
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
    if (!paneStateHydrated) {
      return;
    }

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
      setSelectedProjectId(pendingSearchNavigation.projectId);
      return;
    }

    if (!sortedSessions.some((session) => session.id === pendingSearchNavigation.sessionId)) {
      return;
    }

    setSelectedSessionId(pendingSearchNavigation.sessionId);
    setSessionQueryInput("");
    setHistoryCategories([...pendingSearchNavigation.historyCategories]);
    setSessionPage(0);
    setFocusMessageId(pendingSearchNavigation.messageId);
    setPendingRevealTarget({
      sourceId: pendingSearchNavigation.sourceId,
      messageId: pendingSearchNavigation.messageId,
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
    const isRevealing = pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected ? undefined : historyCategories;
    const effectiveQuery = isRevealing ? "" : effectiveSessionQuery;
    void window.codetrail
      .invoke("sessions:getDetail", {
        sessionId: selectedSessionId,
        page: sessionPage,
        pageSize: PAGE_SIZE,
        categories: effectiveCategories,
        query: effectiveQuery,
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
    selectedSessionId,
    sessionPage,
    historyCategories,
    effectiveSessionQuery,
    pendingRevealTarget,
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

  useEffect(() => {
    if (mainView !== "settings") {
      return;
    }
    if (settingsInfo || settingsLoading) {
      return;
    }
    void loadSettingsInfo();
  }, [loadSettingsInfo, mainView, settingsInfo, settingsLoading]);

  const visibleFocusedMessageId = useMemo(() => {
    if (!focusMessageId || !sessionDetail?.messages) {
      return "";
    }
    return sessionDetail.messages.some((message) => message.id === focusMessageId)
      ? focusMessageId
      : "";
  }, [focusMessageId, sessionDetail?.messages]);
  const focusedMessagePosition = useMemo(() => {
    if (!focusMessageId || !sessionDetail?.messages) {
      return -1;
    }
    return sessionDetail.messages.findIndex((message) => message.id === focusMessageId);
  }, [focusMessageId, sessionDetail?.messages]);

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
    if (
      !focusMessageId ||
      !visibleFocusedMessageId ||
      focusedMessagePosition < 0 ||
      !focusedMessageRef.current
    ) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      focusedMessageRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [focusMessageId, focusedMessagePosition, visibleFocusedMessageId]);

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
  const messagePathRoots = useMemo(() => {
    if (!selectedProject?.path) {
      return [];
    }
    return [selectedProject.path];
  }, [selectedProject?.path]);

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
    const copied = await copyTextToClipboard(sessionDetailsText);
    if (!copied) {
      logError("Failed copying session details", "Clipboard API unavailable");
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

  useKeyboardShortcuts({
    mainView,
    showShortcuts,
    setMainView,
    setShowShortcuts,
    focusGlobalSearch,
    focusSessionSearch,
    applyZoomAction,
    handleForceRefresh,
    handleIncrementalRefresh,
  });

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
  const sessionMessages = sessionDetail?.messages ?? [];
  const isExpandedByDefault = useCallback(
    (category: MessageCategory) => expandedByDefaultCategories.includes(category),
    [expandedByDefaultCategories],
  );
  const scopedMessages = useMemo(
    () =>
      bulkExpandScope === "all"
        ? sessionMessages
        : sessionMessages.filter((message) => message.category === bulkExpandScope),
    [bulkExpandScope, sessionMessages],
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

  const shortcutItems = useMemo(() => {
    const global = [
      "Cmd/Ctrl+1: History view",
      "Cmd/Ctrl+2: Search view",
      "Cmd/Ctrl+F: Focus session search",
      "Cmd/Ctrl+Shift+F: Open global search",
      "Cmd/Ctrl+R: Refresh index",
      "Cmd/Ctrl+Shift+R: Force reindex",
      "Toolbar: Reindex, Copy session, Settings",
      "?: Shortcut help",
      "Esc: Close shortcuts",
    ];
    const contextual =
      mainView === "history"
        ? ["Current view: History", `Selected session: ${selectedSession ? "yes" : "none"}`]
        : ["Current view: Search", `Results: ${searchResponse.totalCount}`];
    return [...contextual, ...global];
  }, [mainView, searchResponse.totalCount, selectedSession]);

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

  const handleRevealInSession = useCallback((messageId: string, sourceId: string) => {
    setSessionQueryInput("");
    setFocusMessageId(messageId);
    setPendingRevealTarget({ messageId, sourceId });
  }, []);

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
          setMainView((value) => (value === "search" ? "history" : "search"))
        }
        onThemeChange={setTheme}
        onIncrementalRefresh={() => void handleIncrementalRefresh()}
        onForceRefresh={() => void handleForceRefresh()}
        onCopySession={() => void handleCopySessionDetails()}
        onToggleFocus={() => setFocusMode((value) => !value)}
        onToggleShortcuts={() => setShowShortcuts((value) => !value)}
        onToggleSettings={() =>
          setMainView((value) => (value === "settings" ? "history" : "settings"))
        }
      />

      <div
        className={`workspace ${isHistoryLayout ? "history-layout" : "single-layout"} ${
          mainView === "search" ? "search-layout" : ""
        }${projectPaneCollapsed ? " projects-collapsed" : ""}${
          sessionPaneCollapsed ? " sessions-collapsed" : ""
        }`}
        style={workspaceStyle}
      >
        {isHistoryLayout ? (
          <>
            <ProjectPane
              sortedProjects={sortedProjects}
              selectedProjectId={selectedProjectId}
              collapsed={projectPaneCollapsed}
              projectQueryInput={projectQueryInput}
              projectProviders={projectProviders}
              providers={PROVIDERS}
              projectProviderCounts={projectProviderCounts}
              onToggleCollapsed={() => setProjectPaneCollapsed((value) => !value)}
              onProjectQueryChange={setProjectQueryInput}
              onToggleProvider={(provider) =>
                setProjectProviders((value) => toggleValue(value, provider))
              }
              onSelectProject={(projectId) => {
                setPendingSearchNavigation(null);
                setSelectedProjectId(projectId);
                setFocusMessageId("");
                setPendingRevealTarget(null);
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
              collapsed={sessionPaneCollapsed}
              onToggleCollapsed={() => setSessionPaneCollapsed((value) => !value)}
              onSelectSession={(sessionId) => {
                setPendingSearchNavigation(null);
                setSelectedSessionId(sessionId);
                setSessionPage(0);
                setFocusMessageId("");
                setPendingRevealTarget(null);
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
                    <div className="expand-scope-control">
                      <button
                        type="button"
                        className="toolbar-btn expand-scope-action"
                        onClick={handleToggleScopedMessagesExpanded}
                        disabled={scopedMessages.length === 0}
                        aria-label={scopedExpandCollapseLabel}
                        title={scopedExpandCollapseLabel}
                      >
                        <ToolbarIcon
                          name={areScopedMessagesExpanded ? "collapseAll" : "expandAll"}
                        />
                        {scopedActionLabel}
                      </button>
                      <select
                        className="expand-scope-select"
                        value={bulkExpandScope}
                        onChange={(event) => {
                          const nextScope = event.target.value;
                          setBulkExpandScope(
                            nextScope === "all" ? "all" : (nextScope as MessageCategory),
                          );
                        }}
                        aria-label="Select expand and collapse scope"
                        title="Choose which message type expand/collapse applies to"
                      >
                        <option value="all">All</option>
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {prettyCategory(category)}
                          </option>
                        ))}
                      </select>
                    </div>
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
                      pathRoots={messagePathRoots}
                      isFocused={message.id === focusMessageId}
                      isExpanded={
                        messageExpanded[message.id] ?? isExpandedByDefault(message.category)
                      }
                      onToggleExpanded={() =>
                        setMessageExpanded((value) => ({
                          ...value,
                          [message.id]: !(
                            value[message.id] ?? isExpandedByDefault(message.category)
                          ),
                        }))
                      }
                      onToggleFocused={() =>
                        setFocusMessageId((value) => (value === message.id ? "" : message.id))
                      }
                      onRevealInSession={() => handleRevealInSession(message.id, message.sourceId)}
                      cardRef={focusMessageId === message.id ? focusedMessageRef : null}
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
          ) : mainView === "search" ? (
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
                        historyCategories.includes(category) ? " active" : ""
                      }`}
                      onClick={() =>
                        setHistoryCategories((value) =>
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
                          messageId: result.messageId,
                          sourceId: result.messageSourceId,
                          historyCategories: [...historyCategories],
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
          ) : (
            <SettingsView
              info={settingsInfo}
              loading={settingsLoading}
              error={settingsError}
              monoFontFamily={monoFontFamily}
              regularFontFamily={regularFontFamily}
              monoFontSize={monoFontSize}
              regularFontSize={regularFontSize}
              useMonospaceForAllMessages={useMonospaceForAllMessages}
              onMonoFontFamilyChange={setMonoFontFamily}
              onRegularFontFamilyChange={setRegularFontFamily}
              onMonoFontSizeChange={setMonoFontSize}
              onRegularFontSizeChange={setRegularFontSize}
              onUseMonospaceForAllMessagesChange={setUseMonospaceForAllMessages}
              expandedByDefaultCategories={expandedByDefaultCategories}
              onToggleExpandedByDefault={(category) =>
                setExpandedByDefaultCategories((value) =>
                  toggleValue<MessageCategory>(value, category),
                )
              }
            />
          )}
        </section>
      </div>

      {showShortcuts ? (
        <ShortcutsDialog shortcutItems={shortcutItems} onClose={() => setShowShortcuts(false)} />
      ) : null}
    </main>
  );
}
