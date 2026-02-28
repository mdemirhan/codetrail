import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import type { MessageCategory, Provider } from "@cch/core";
import type { IpcResponse } from "@cch/core";

type HealthStatus = IpcResponse<"app:getHealth">;
type ProjectSummary = IpcResponse<"projects:list">["projects"][number];
type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];
type SessionDetail = IpcResponse<"sessions:getDetail">;
type SearchQueryResponse = IpcResponse<"search:query">;

const PAGE_SIZE = 100;

const PROVIDERS: Provider[] = ["claude", "codex", "gemini"];
const CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];
const EMPTY_CATEGORY_COUNTS = {
  user: 0,
  assistant: 0,
  tool_use: 0,
  tool_result: 0,
  thinking: 0,
  system: 0,
};

type MainView = "history" | "search";
type ProjectSortMode = "recent" | "name" | "provider";
type SessionSortMode = "recent" | "messages" | "model";

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMode, setRefreshMode] = useState<"incremental" | "force">("incremental");
  const [lastRefreshJobId, setLastRefreshJobId] = useState("");
  const [statusText, setStatusText] = useState("");

  const [mainView, setMainView] = useState<MainView>("history");
  const [focusMode, setFocusMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [projectQueryInput, setProjectQueryInput] = useState("");
  const [projectProviders, setProjectProviders] = useState<Provider[]>([]);
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>("recent");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionSortMode, setSessionSortMode] = useState<SessionSortMode>("recent");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>([...CATEGORIES]);
  const [zoom, setZoom] = useState(100);
  const [focusSourceId, setFocusSourceId] = useState("");

  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchProjectQueryInput, setSearchProjectQueryInput] = useState("");
  const [searchProviders, setSearchProviders] = useState<Provider[]>([]);
  const [searchCategories, setSearchCategories] = useState<MessageCategory[]>([...CATEGORIES]);
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchResponse, setSearchResponse] = useState<SearchQueryResponse>({
    query: "",
    totalCount: 0,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
    results: [],
  });

  const [projectPaneWidth, setProjectPaneWidth] = useState(300);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(320);
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

  const focusedMessageRef = useRef<HTMLDivElement | null>(null);
  const sortedProjects = useMemo(() => {
    const next = [...projects];
    next.sort((left, right) => {
      if (projectSortMode === "recent") {
        return (
          compareRecent(right.lastActivity, left.lastActivity) ||
          left.name.localeCompare(right.name)
        );
      }
      if (projectSortMode === "provider") {
        return (
          left.provider.localeCompare(right.provider) ||
          left.name.localeCompare(right.name) ||
          compareRecent(right.lastActivity, left.lastActivity)
        );
      }
      return (
        left.name.localeCompare(right.name) ||
        left.provider.localeCompare(right.provider) ||
        compareRecent(right.lastActivity, left.lastActivity)
      );
    });
    return next;
  }, [projects, projectSortMode]);

  const sortedSessions = useMemo(() => {
    const next = [...sessions];
    next.sort((left, right) => {
      if (sessionSortMode === "messages") {
        return (
          right.messageCount - left.messageCount ||
          compareRecent(sessionActivityOf(right), sessionActivityOf(left))
        );
      }
      if (sessionSortMode === "model") {
        return (
          left.modelNames.localeCompare(right.modelNames) ||
          compareRecent(sessionActivityOf(right), sessionActivityOf(left))
        );
      }
      return (
        compareRecent(sessionActivityOf(right), sessionActivityOf(left)) ||
        right.messageCount - left.messageCount
      );
    });
    return next;
  }, [sessions, sessionSortMode]);

  const loadProjects = useCallback(async () => {
    const response = await window.cch.invoke("projects:list", {
      providers: projectProviders.length > 0 ? projectProviders : undefined,
      query: projectQuery,
    });
    setProjects(response.projects);
  }, [projectProviders, projectQuery]);

  const loadSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions([]);
      setSelectedSessionId("");
      return;
    }

    const response = await window.cch.invoke("sessions:list", { projectId: selectedProjectId });
    setSessions(response.sessions);
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

    const response = await window.cch.invoke("search:query", {
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
    void window.cch.invoke("app:getHealth", {}).then((result) => {
      if (!cancelled) {
        setHealth(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadProjects().catch((error: unknown) => {
      if (!cancelled) {
        setStatusText(`Failed loading projects: ${toErrorMessage(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  useEffect(() => {
    if (sortedProjects.length === 0) {
      setSelectedProjectId("");
      setSearchProjectId("");
      return;
    }

    if (!sortedProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(sortedProjects[0]?.id ?? "");
    }

    if (searchProjectId && !sortedProjects.some((project) => project.id === searchProjectId)) {
      setSearchProjectId("");
    }
  }, [searchProjectId, selectedProjectId, sortedProjects]);

  useEffect(() => {
    let cancelled = false;
    void loadSessions().catch((error: unknown) => {
      if (!cancelled) {
        setStatusText(`Failed loading sessions: ${toErrorMessage(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    if (sortedSessions.length === 0) {
      setSelectedSessionId("");
      return;
    }

    if (!sortedSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sortedSessions[0]?.id ?? "");
    }
  }, [selectedSessionId, sortedSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    void window.cch
      .invoke("sessions:getDetail", {
        sessionId: selectedSessionId,
        page: sessionPage,
        pageSize: PAGE_SIZE,
        categories: isAllHistoryCategoriesSelected ? undefined : historyCategories,
        query: sessionQuery,
        focusSourceId: focusSourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSessionDetail(response);
        if (response.page !== sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatusText(`Failed loading session detail: ${toErrorMessage(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, sessionPage, historyCategories, sessionQuery, focusSourceId]);

  useEffect(() => {
    let cancelled = false;
    void loadSearch().catch((error: unknown) => {
      if (!cancelled) {
        setStatusText(`Search failed: ${toErrorMessage(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSearch]);

  const messageCount = sessionDetail?.messages.length ?? 0;

  useEffect(() => {
    if (!focusSourceId || !focusedMessageRef.current || messageCount === 0) {
      return;
    }

    focusedMessageRef.current.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [focusSourceId, messageCount]);

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
      setRefreshMode(force ? "force" : "incremental");
      setStatusText("");
      try {
        const result = await window.cch.invoke("indexer:refresh", { force });
        setLastRefreshJobId(result.jobId);
        await Promise.all([loadProjects(), loadSessions(), loadSearch()]);
      } catch (error) {
        setStatusText(`Refresh failed: ${toErrorMessage(error)}`);
      } finally {
        setRefreshing(false);
      }
    },
    [loadProjects, loadSearch, loadSessions],
  );

  const handleIncrementalRefresh = useCallback(async () => {
    await handleRefresh(false);
  }, [handleRefresh]);

  const handleForceRefresh = useCallback(async () => {
    await handleRefresh(true);
  }, [handleRefresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      if (event.key === "?") {
        setShowShortcuts(true);
      } else if (event.key === "Escape") {
        setShowShortcuts(false);
      } else if (command && event.key === "1") {
        event.preventDefault();
        setMainView("history");
      } else if (command && event.key === "2") {
        event.preventDefault();
        setMainView("search");
      } else if (command && shift && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleForceRefresh();
      } else if (command && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleIncrementalRefresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleForceRefresh, handleIncrementalRefresh]);

  const selectedSession = useMemo(
    () => sortedSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sortedSessions],
  );

  const totalPages = useMemo(() => {
    const totalCount = sessionDetail?.totalCount ?? 0;
    if (totalCount === 0) {
      return 1;
    }
    return Math.ceil(totalCount / PAGE_SIZE);
  }, [sessionDetail?.totalCount]);

  const canZoomIn = zoom < 150;
  const canZoomOut = zoom > 80;
  const viewLabel = mainView === "history" ? "History" : "Search";
  const historyCategoryCounts = sessionDetail?.categoryCounts ?? EMPTY_CATEGORY_COUNTS;
  const isHistoryLayout = mainView === "history" && !focusMode;
  const workspaceStyle = isHistoryLayout
    ? {
        gridTemplateColumns: `${projectPaneWidth}px 8px ${sessionPaneWidth}px 8px minmax(420px, 1fr)`,
      }
    : undefined;

  const shortcutItems = useMemo(() => {
    const global = [
      "Cmd/Ctrl+1: History view",
      "Cmd/Ctrl+2: Search view",
      "Cmd/Ctrl+R: Refresh index",
      "Cmd/Ctrl+Shift+R: Force reindex",
      "?: Shortcut help",
      "Esc: Close shortcuts",
    ];
    const contextual =
      mainView === "history"
        ? ["Current view: History", `Selected session: ${selectedSession ? "yes" : "none"}`]
        : ["Current view: Search", `Results: ${searchResponse.totalCount}`];
    return [...contextual, ...global];
  }, [mainView, searchResponse.totalCount, selectedSession]);

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <h1>CCH TS Desktop</h1>
          <p>
            {health ? `v${health.version}` : "starting..."}{" "}
            {lastRefreshJobId ? `| ${lastRefreshJobId}` : ""}
          </p>
        </div>
        <div className="topbar-center">
          <button
            type="button"
            className={mainView === "history" ? "tab-button active" : "tab-button"}
            onClick={() => setMainView("history")}
          >
            History
          </button>
          <button
            type="button"
            className={mainView === "search" ? "tab-button active" : "tab-button"}
            onClick={() => setMainView("search")}
          >
            Global Search
          </button>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            onClick={() => void handleIncrementalRefresh()}
            disabled={refreshing}
          >
            {refreshing && refreshMode === "incremental" ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" onClick={() => void handleForceRefresh()} disabled={refreshing}>
            {refreshing && refreshMode === "force" ? "Reindexing..." : "Force Reindex"}
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((value) => !value)}
            disabled={mainView !== "history"}
          >
            {focusMode ? "Exit Focus" : "Focus"}
          </button>
          <button type="button" onClick={() => setShowShortcuts((value) => !value)}>
            Shortcuts
          </button>
        </div>
      </header>

      {statusText ? <p className="status-line">{statusText}</p> : null}

      <div
        className={`workspace ${isHistoryLayout ? "history-layout" : "single-layout"} ${mainView === "search" ? "search-layout" : ""}`}
        style={workspaceStyle}
      >
        {isHistoryLayout ? (
          <>
            <aside className="pane project-pane">
              <div className="pane-head">
                <h2>Projects</h2>
                <div className="pane-head-controls">
                  <span>{sortedProjects.length}</span>
                  <select
                    value={projectSortMode}
                    onChange={(event) => setProjectSortMode(event.target.value as ProjectSortMode)}
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name</option>
                    <option value="provider">Provider</option>
                  </select>
                </div>
              </div>
              <input
                value={projectQueryInput}
                onChange={(event) => setProjectQueryInput(event.target.value)}
                placeholder="Filter projects"
              />
              <div className="chip-row">
                {PROVIDERS.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={projectProviders.includes(provider) ? "chip active" : "chip"}
                    onClick={() => setProjectProviders((value) => toggleValue(value, provider))}
                  >
                    {provider}
                  </button>
                ))}
              </div>
              <div className="project-list">
                {sortedProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={project.id === selectedProjectId ? "list-item active" : "list-item"}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span>{project.name || project.path || "(no project path)"}</span>
                    <small>
                      {project.provider} | {formatDate(project.lastActivity)}
                    </small>
                  </button>
                ))}
              </div>
              {selectedProjectId ? (
                <button
                  type="button"
                  className="context-action"
                  onClick={() =>
                    void openInFileManager(sortedProjects, selectedProjectId, setStatusText)
                  }
                >
                  Open Project Location
                </button>
              ) : null}
            </aside>

            <div className="pane-resizer" onPointerDown={beginResize("project")} />

            <aside className="pane session-pane">
              <div className="pane-head">
                <h2>Sessions</h2>
                <div className="pane-head-controls">
                  <span>{sortedSessions.length}</span>
                  <select
                    value={sessionSortMode}
                    onChange={(event) => setSessionSortMode(event.target.value as SessionSortMode)}
                  >
                    <option value="recent">Recent</option>
                    <option value="messages">Messages</option>
                    <option value="model">Model</option>
                  </select>
                </div>
              </div>
              <div className="session-list">
                {sortedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={session.id === selectedSessionId ? "list-item active" : "list-item"}
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setSessionPage(0);
                      setFocusSourceId("");
                      setMainView("history");
                    }}
                  >
                    <span>{session.modelNames || session.id}</span>
                    <small>
                      {session.messageCount} msgs | {formatDate(sessionActivityOf(session))}
                    </small>
                  </button>
                ))}
              </div>
              {selectedSession ? (
                <button
                  type="button"
                  className="context-action"
                  onClick={() => void openPath(selectedSession.filePath, setStatusText)}
                >
                  Open Session Location
                </button>
              ) : null}
            </aside>

            <div className="pane-resizer" onPointerDown={beginResize("session")} />
          </>
        ) : null}

        <section className="pane content-pane" style={{ fontSize: `${zoom}%` }}>
          {mainView === "history" ? (
            <div className="history-view">
              <div className="content-head">
                <div>
                  <h2>{selectedSession?.modelNames || "Session Detail"}</h2>
                  <p>
                    {selectedSession?.provider ?? "-"} | {selectedSession?.messageCount ?? 0}{" "}
                    messages
                  </p>
                </div>
                <div className="zoom-controls">
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.max(80, value - 5))}
                    disabled={!canZoomOut}
                  >
                    A-
                  </button>
                  <button type="button" onClick={() => setZoom(100)}>
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.min(150, value + 5))}
                    disabled={!canZoomIn}
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="filter-row">
                <input
                  value={sessionQueryInput}
                  onChange={(event) => {
                    setSessionQueryInput(event.target.value);
                    setSessionPage(0);
                  }}
                  placeholder="Search in session"
                />
                <div className="chip-row">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={historyCategories.includes(category) ? "chip active" : "chip"}
                      onClick={() => {
                        setHistoryCategories((value) =>
                          toggleRequiredValue<MessageCategory>(value, category, CATEGORIES),
                        );
                        setSessionPage(0);
                      }}
                    >
                      {prettyCategory(category)} ({historyCategoryCounts[category]})
                    </button>
                  ))}
                </div>
              </div>

              <div className="message-list">
                {sessionDetail?.messages.length ? (
                  sessionDetail.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message-card category-${message.category}${
                        focusSourceId && message.sourceId === focusSourceId ? " focused" : ""
                      }`}
                      ref={
                        focusSourceId && message.sourceId === focusSourceId
                          ? focusedMessageRef
                          : null
                      }
                    >
                      <header>
                        <span>{prettyCategory(message.category)}</span>
                        <small>
                          {message.provider} | {formatDate(message.createdAt)}
                        </small>
                      </header>
                      <div className="message-content">
                        <MessageContent
                          text={message.content}
                          category={message.category}
                          query={sessionQuery}
                        />
                      </div>
                      <footer>
                        <small>
                          in:{message.tokenInput ?? "-"} out:{message.tokenOutput ?? "-"} src:
                          {message.sourceId}
                        </small>
                      </footer>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No messages match current filters.</p>
                )}
              </div>

              <div className="pagination-row">
                <button
                  type="button"
                  onClick={() => setSessionPage((value) => Math.max(0, value - 1))}
                  disabled={sessionPage <= 0}
                >
                  Previous
                </button>
                <span>
                  Page {sessionPage + 1} / {totalPages} ({sessionDetail?.totalCount ?? 0} messages)
                </span>
                <button
                  type="button"
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
                  value={searchProjectId}
                  onChange={(event) => setSearchProjectId(event.target.value)}
                >
                  <option value="">All projects</option>
                  {sortedProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.provider}: {project.name || project.path || "(unknown project)"}
                    </option>
                  ))}
                </select>
                <div className="chip-row">
                  {PROVIDERS.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      className={searchProviders.includes(provider) ? "chip active" : "chip"}
                      onClick={() => setSearchProviders((value) => toggleValue(value, provider))}
                    >
                      {provider}
                    </button>
                  ))}
                </div>
                <div className="chip-row">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={searchCategories.includes(category) ? "chip active" : "chip"}
                      onClick={() =>
                        setSearchCategories((value) =>
                          toggleRequiredValue<MessageCategory>(value, category, CATEGORIES),
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
                      className="search-result"
                      onClick={() => {
                        const matchingProject = sortedProjects.find(
                          (project) =>
                            project.path === result.projectPath &&
                            project.provider === result.provider,
                        );
                        if (matchingProject) {
                          setSelectedProjectId(matchingProject.id);
                        }
                        setSelectedSessionId(result.sessionId);
                        setSessionPage(0);
                        setFocusSourceId(result.messageSourceId);
                        setMainView("history");
                      }}
                    >
                      <header>
                        <span>{result.provider}</span>
                        <small>
                          {prettyCategory(result.category)} | {formatDate(result.createdAt)}
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
        <dialog open className="shortcuts-dialog">
          <h3>Keyboard Shortcuts</h3>
          {shortcutItems.map((item) => (
            <p key={`dialog-${item}`}>{item}</p>
          ))}
          <button type="button" onClick={() => setShowShortcuts(false)}>
            Close
          </button>
        </dialog>
      ) : null}
    </main>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}

function toggleValue<T>(values: T[], value: T): T[] {
  if (values.includes(value)) {
    return values.filter((item) => item !== value);
  }
  return [...values, value];
}

function toggleRequiredValue<T>(values: T[], value: T, universe: readonly T[]): T[] {
  if (values.includes(value)) {
    if (values.length <= 1) {
      return values;
    }
    return values.filter((item) => item !== value);
  }

  const next = [...values, value];
  if (next.length >= universe.length) {
    return [...universe];
  }
  return next;
}

function sessionActivityOf(session: SessionSummary): string | null {
  return session.endedAt ?? session.startedAt;
}

function compareRecent(left: string | null, right: string | null): number {
  const leftTs = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
  const rightTs = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
  return leftTs - rightTs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function prettyCategory(category: MessageCategory): string {
  if (category === "tool_use") {
    return "tool use";
  }
  if (category === "tool_result") {
    return "tool result";
  }
  return category;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

async function openInFileManager(
  projects: ProjectSummary[],
  selectedProjectId: string,
  setStatusText: (value: string) => void,
): Promise<void> {
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (!selected) {
    return;
  }
  await openPath(selected.path, setStatusText);
}

async function openPath(path: string, setStatusText: (value: string) => void): Promise<void> {
  const result = await window.cch.invoke("path:openInFileManager", { path });
  if (!result.ok) {
    setStatusText(result.error ?? `Failed to open ${path}`);
  }
}

function HighlightedText({
  text,
  query,
  allowMarks,
}: {
  text: string;
  query: string;
  allowMarks: boolean;
}) {
  if (allowMarks) {
    return <>{renderMarkedSnippet(text)}</>;
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <pre>{text}</pre>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig"));
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const [position, part] of parts.entries()) {
    const key = `${cursor}:${part.length}:${position % 2 === 1 ? "m" : "t"}`;
    if (position % 2 === 1) {
      content.push(<mark key={key}>{part}</mark>);
    } else {
      content.push(<span key={key}>{part}</span>);
    }
    cursor += part.length;
  }

  return <pre>{content}</pre>;
}

function MessageContent({
  text,
  category,
  query,
}: {
  text: string;
  category: MessageCategory;
  query: string;
}) {
  if (category === "thinking") {
    return (
      <details className="thinking-block" open>
        <summary>Thinking</summary>
        <pre>{buildHighlightedTextNodes(text, query, "thinking")}</pre>
      </details>
    );
  }

  if (category === "tool_use" || category === "tool_result") {
    const formatted = tryFormatJson(text);
    return <pre className="tool-block">{buildHighlightedTextNodes(formatted, query, "tool")}</pre>;
  }

  return <div className="rich-block">{renderRichText(text, query, "msg")}</div>;
}

function renderRichText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codeFence = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match = codeFence.exec(value);

  while (match) {
    const blockStart = match.index;
    if (blockStart > cursor) {
      const textChunk = value.slice(cursor, blockStart);
      nodes.push(renderTextChunk(textChunk, query, `${keyPrefix}:${cursor}:t`));
    }

    const language = match[1] ?? "";
    const codeValue = match[2] ?? "";
    nodes.push(
      <CodeBlock
        key={`${keyPrefix}:${blockStart}:c`}
        language={language}
        codeValue={codeValue}
        query={query}
      />,
    );

    cursor = blockStart + match[0].length;
    match = codeFence.exec(value);
  }

  if (cursor < value.length) {
    nodes.push(renderTextChunk(value.slice(cursor), query, `${keyPrefix}:${cursor}:tail`));
  }

  if (nodes.length === 0) {
    nodes.push(renderTextChunk(value, query, `${keyPrefix}:only`));
  }
  return nodes;
}

function renderTextChunk(value: string, query: string, keyPrefix: string): ReactNode {
  const lines = value.split(/\r?\n/);
  const items: ReactNode[] = [];
  let lineCursor = 0;
  let bulletBuffer: Array<{ key: string; content: string }> = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) {
      return;
    }

    items.push(
      <ul key={`${keyPrefix}:${bulletBuffer[0]?.key ?? "b"}:list`} className="md-list">
        {bulletBuffer.map((bullet) => (
          <li key={bullet.key}>
            {renderInlineText(bullet.content, query, `${keyPrefix}:${bullet.key}`)}
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const currentKey = `${lineCursor}`;
    lineCursor += line.length + 1;

    if (line.startsWith("- ")) {
      bulletBuffer.push({ key: currentKey, content: line.slice(2) });
      continue;
    }

    flushBullets();

    if (line.trim().length === 0) {
      items.push(<div key={`${keyPrefix}:${currentKey}:empty`} className="md-empty" />);
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const marks = headingMatch[1] ?? "";
      const level = marks.length;
      const text = headingMatch[2] ?? "";
      if (level === 1) {
        items.push(
          <h3 key={`${keyPrefix}:${currentKey}:h1`} className="md-h1">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h1`)}
          </h3>,
        );
      } else if (level === 2) {
        items.push(
          <h4 key={`${keyPrefix}:${currentKey}:h2`} className="md-h2">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h2`)}
          </h4>,
        );
      } else {
        items.push(
          <h5 key={`${keyPrefix}:${currentKey}:h3`} className="md-h3">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h3`)}
          </h5>,
        );
      }
      continue;
    }

    items.push(
      <p key={`${keyPrefix}:${currentKey}:p`} className="md-p">
        {renderInlineText(line, query, `${keyPrefix}:${currentKey}:p`)}
      </p>,
    );
  }

  flushBullets();

  return <div key={`${keyPrefix}:chunk`}>{items}</div>;
}

function renderInlineText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const tokens = value.split(/(`[^`]+`)/g);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const key = `${keyPrefix}:${cursor}`;
    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      nodes.push(<code key={`${key}:code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(...buildHighlightedTextNodes(token, query, `${key}:txt`));
    }
    cursor += token.length;
  }
  return nodes;
}

function CodeBlock({
  language,
  codeValue,
  query,
}: {
  language: string;
  codeValue: string;
  query: string;
}) {
  const lines = codeValue.split(/\r?\n/);
  const renderedLines: ReactNode[] = [];
  let cursor = 0;
  for (const line of lines) {
    const lineKey = `${cursor}:${line.length}`;
    if (line.startsWith("+")) {
      renderedLines.push(
        <span key={`${lineKey}:add`} className="diff-add">
          {buildHighlightedTextNodes(line, query, `${lineKey}:add`)}
          {"\n"}
        </span>,
      );
    } else if (line.startsWith("-")) {
      renderedLines.push(
        <span key={`${lineKey}:remove`} className="diff-remove">
          {buildHighlightedTextNodes(line, query, `${lineKey}:remove`)}
          {"\n"}
        </span>,
      );
    } else {
      renderedLines.push(
        <span key={`${lineKey}:plain`}>
          {buildHighlightedTextNodes(line, query, `${lineKey}:plain`)}
          {"\n"}
        </span>,
      );
    }
    cursor += line.length + 1;
  }

  return (
    <div className="code-block">
      <div className="code-meta">{language || "code"}</div>
      <pre>{renderedLines}</pre>
    </div>
  );
}

function buildHighlightedTextNodes(value: string, query: string, keyPrefix: string): ReactNode[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [<span key={`${keyPrefix}:all`}>{value}</span>];
  }

  const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig");
  const parts = value.split(matcher);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [index, part] of parts.entries()) {
    const key = `${keyPrefix}:${cursor}:${part.length}`;
    if (index % 2 === 1) {
      nodes.push(<mark key={`${key}:m`}>{part}</mark>);
    } else if (part.length > 0) {
      nodes.push(<span key={`${key}:t`}>{part}</span>);
    }
    cursor += part.length;
  }
  return nodes;
}

function renderMarkedSnippet(value: string): ReactNode {
  const segments = value.split(/(<\/?mark>)/g);
  let markOpen = false;
  let cursor = 0;
  const content: ReactNode[] = [];

  for (const segment of segments) {
    if (segment === "<mark>") {
      markOpen = true;
      cursor += segment.length;
      continue;
    }
    if (segment === "</mark>") {
      markOpen = false;
      cursor += segment.length;
      continue;
    }

    const key = `${cursor}:${segment.length}:${markOpen ? "m" : "t"}`;
    if (markOpen) {
      content.push(<mark key={key}>{segment}</mark>);
    } else {
      content.push(<span key={key}>{segment}</span>);
    }
    cursor += segment.length;
  }

  return content;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tryFormatJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}
