import type { AppStateStore, PaneState } from "./appStateStore";

import type { Provider } from "@codetrail/core";
import { createSettingsInfoFixture } from "@codetrail/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetPath,
  mockGetVersion,
  mockInitializeDatabase,
  mockResolveSystemMessageRegexRules,
  mockInitializeBookmarkStore,
  mockResolveBookmarksDbPath,
  mockCreateQueryService,
  mockWorkerIndexingRunner,
  mockRegisterIpcHandlers,
  mockEnqueue,
  mockPurgeProviders,
  mockEnqueueChangedFiles,
  mockGetStatus,
  mockStat,
  mockRealpath,
  mockOpenPath,
  mockShowItemInFolder,
  mockListProjects,
  mockGetProjectCombinedDetail,
  mockListSessions,
  mockGetSessionDetail,
  mockListProjectBookmarks,
  mockToggleBookmark,
  mockRunSearchQuery,
  mockQueryServiceClose,
  mockFileWatcherService,
  mockFileWatcherInstances,
} = vi.hoisted(() => {
  const fileWatcherInstances: Array<{
    roots: string[];
    options: Record<string, unknown>;
    onFilesChanged: (batch: { changedPaths: string[]; requiresFullScan: boolean }) => Promise<void>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    getWatchedRoots: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    mockGetPath: vi.fn((key: string) => {
      if (key === "home") {
        return "/Users/test";
      }
      if (key === "sessionData") {
        return "/tmp/session-data";
      }
      return "/tmp/user-data";
    }),
    mockGetVersion: vi.fn(() => "0.1.0"),
    mockInitializeDatabase: vi.fn<
      () => { schemaVersion: number | undefined; tables: Array<{ name: string }> }
    >(() => ({ schemaVersion: 7, tables: [{ name: "messages" }] })),
    mockResolveSystemMessageRegexRules: vi.fn((overrides?: Record<string, string[]>) => {
      return (
        overrides ?? {
          claude: ["^<command-name>"],
          codex: ["^<environment_context>"],
          gemini: [],
        }
      );
    }),
    mockInitializeBookmarkStore: vi.fn(),
    mockResolveBookmarksDbPath: vi.fn((dbPath: string) => `${dbPath}.bookmarks`),
    mockCreateQueryService: vi.fn(),
    mockWorkerIndexingRunner: vi.fn(),
    mockRegisterIpcHandlers: vi.fn(),
    mockEnqueue: vi.fn(async () => ({ jobId: "job-1" })),
    mockPurgeProviders: vi.fn(async () => ({ jobId: "purge-1" })),
    mockEnqueueChangedFiles: vi.fn(async () => ({ jobId: "job-2" })),
    mockGetStatus: vi.fn(() => ({
      running: false,
      queuedJobs: 0,
      activeJobId: null,
      completedJobs: 0,
    })),
    mockStat: vi.fn<() => Promise<{ isFile: () => boolean }>>(async () => ({
      isFile: () => false,
    })),
    mockRealpath: vi.fn(async (pathValue: string) => pathValue),
    mockOpenPath: vi.fn(async () => ""),
    mockShowItemInFolder: vi.fn(),
    mockListProjects: vi.fn(() => ({
      projects: [
        {
          id: "project-1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          lastActivity: "2026-03-01T12:00:00.000Z",
        },
      ],
    })),
    mockGetProjectCombinedDetail: vi.fn((payload) => ({
      projectId: payload.projectId,
      messages: [],
    })),
    mockListSessions: vi.fn((payload) => ({ items: [{ id: "s1", ...payload }], total: 1 })),
    mockGetSessionDetail: vi.fn((payload) => ({ id: payload.id, messages: [] })),
    mockListProjectBookmarks: vi.fn((payload) => ({ items: [{ id: "b1", ...payload }], total: 1 })),
    mockToggleBookmark: vi.fn((payload) => ({ bookmarked: payload.bookmarked })),
    mockRunSearchQuery: vi.fn((payload) => ({ items: [{ id: "m1", ...payload }], total: 1 })),
    mockQueryServiceClose: vi.fn(),
    mockFileWatcherInstances: fileWatcherInstances,
    mockFileWatcherService: vi.fn(
      (
        roots: string[],
        onFilesChanged: (batch: {
          changedPaths: string[];
          requiresFullScan: boolean;
        }) => Promise<void>,
        options: Record<string, unknown> = {},
      ) => {
        const instance = {
          roots,
          options,
          onFilesChanged,
          start: vi.fn(async () => {}),
          stop: vi.fn(async () => {}),
          getWatchedRoots: vi.fn(() => roots),
          getStatus: vi.fn(() => ({ running: false, processing: false, pendingPathCount: 0 })),
        };
        fileWatcherInstances.push(instance);
        return instance;
      },
    ),
  };
});

vi.mock("@codetrail/core", async () => {
  const actual = await vi.importActual<typeof import("@codetrail/core")>("@codetrail/core");
  return {
    ...actual,
    DATABASE_SCHEMA_VERSION: 42,
    DEFAULT_DISCOVERY_CONFIG: {
      claudeRoot: "/claude/root",
      codexRoot: "/codex/root",
      geminiRoot: "/gemini/root",
      geminiHistoryRoot: null,
      geminiProjectsPath: null,
      cursorRoot: "/cursor/root",
      copilotRoot: "/copilot/root",
      includeClaudeSubagents: false,
    },
    initializeDatabase: mockInitializeDatabase,
    resolveSystemMessageRegexRules: mockResolveSystemMessageRegexRules,
  };
});

vi.mock("./data/queryService", () => ({
  createQueryService: mockCreateQueryService,
}));

vi.mock("./data/bookmarkStore", () => ({
  initializeBookmarkStore: mockInitializeBookmarkStore,
  resolveBookmarksDbPath: mockResolveBookmarksDbPath,
}));

vi.mock("./indexingRunner", () => ({
  WorkerIndexingRunner: mockWorkerIndexingRunner,
}));

vi.mock("./ipc", () => ({
  registerIpcHandlers: mockRegisterIpcHandlers,
}));

vi.mock("./fileWatcherService", () => ({
  FileWatcherService: mockFileWatcherService,
}));

vi.mock("node:fs/promises", () => ({
  realpath: mockRealpath,
  stat: mockStat,
}));

vi.mock("electron", () => ({
  app: {
    getPath: mockGetPath,
    getVersion: mockGetVersion,
  },
  ipcMain: {},
  shell: {
    openPath: mockOpenPath,
    showItemInFolder: mockShowItemInFolder,
  },
}));

import { bootstrapMainProcess, shutdownMainProcess } from "./bootstrap";

type Handler = (payload: unknown, event?: unknown) => unknown;
type HandlerMap = Partial<Record<string, Handler>>;

function getRequiredHandler(handlers: HandlerMap, channel: string): Handler {
  const handler = handlers[channel];
  if (!handler) {
    throw new Error(`Missing handler registration for ${channel}`);
  }
  return handler;
}

describe("bootstrapMainProcess", () => {
  let handlers: HandlerMap;
  let setPaneState: ReturnType<typeof vi.fn>;
  let setIndexingState: ReturnType<typeof vi.fn>;
  const paneState: PaneState = {
    projectPaneWidth: 220,
    sessionPaneWidth: 480,
    projectPaneCollapsed: false,
    sessionPaneCollapsed: true,
    projectProviders: ["claude", "codex"],
    historyCategories: ["assistant"],
    expandedByDefaultCategories: ["assistant", "tool_use"],
    searchProviders: ["claude"],
    theme: "dark",
    monoFontFamily: "droid_sans_mono",
    regularFontFamily: "inter",
    monoFontSize: "13px",
    regularFontSize: "14px",
    useMonospaceForAllMessages: true,
    preferredAutoRefreshStrategy: "watch-5s",
    selectedProjectId: "project-1",
    selectedSessionId: "session-1",
    historyMode: "bookmarks",
    projectSortDirection: "desc",
    sessionSortDirection: "desc",
    messageSortDirection: "asc",
    bookmarkSortDirection: "asc",
    projectAllSortDirection: "desc",
    sessionPage: 2,
    sessionScrollTop: 180,
    systemMessageRegexRules: {
      claude: ["^<command-name>"],
      codex: ["^<environment_context>"],
      gemini: [],
      cursor: [],
      copilot: [],
    },
  };

  beforeEach(() => {
    handlers = {};
    setPaneState = vi.fn();
    setIndexingState = vi.fn();
    vi.clearAllMocks();
    mockFileWatcherInstances.length = 0;
    void shutdownMainProcess();

    mockWorkerIndexingRunner.mockImplementation(() => ({
      enqueue: mockEnqueue,
      purgeProviders: mockPurgeProviders,
      enqueueChangedFiles: mockEnqueueChangedFiles,
      getStatus: mockGetStatus,
    }));
    mockCreateQueryService.mockImplementation(() => ({
      listProjects: mockListProjects,
      getProjectCombinedDetail: mockGetProjectCombinedDetail,
      listSessions: mockListSessions,
      getSessionDetail: mockGetSessionDetail,
      listProjectBookmarks: mockListProjectBookmarks,
      toggleBookmark: mockToggleBookmark,
      runSearchQuery: mockRunSearchQuery,
      close: mockQueryServiceClose,
    }));
    mockRegisterIpcHandlers.mockImplementation((_ipcMain, nextHandlers) => {
      handlers = nextHandlers as HandlerMap;
    });
    mockInitializeDatabase.mockReturnValue({ schemaVersion: 7, tables: [{ name: "messages" }] });
    mockStat.mockResolvedValue({ isFile: () => false });
    mockRealpath.mockImplementation(async (pathValue: string) => pathValue);
    mockOpenPath.mockResolvedValue("");
  });

  it("wires all handlers and delegates query/indexing operations", async () => {
    const appStateStore: Pick<
      AppStateStore,
      "getFilePath" | "getPaneState" | "setPaneState" | "getIndexingState" | "setIndexingState"
    > = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => paneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      setPaneState,
      setIndexingState,
    };

    const result = await bootstrapMainProcess({
      dbPath: "/tmp/codetrail.sqlite",
      runStartupIndexing: false,
      appStateStore: appStateStore as AppStateStore,
    });

    expect(result).toEqual({ schemaVersion: 7, tableCount: 1 });
    expect(mockInitializeDatabase).toHaveBeenCalledWith("/tmp/codetrail.sqlite");
    expect(mockResolveBookmarksDbPath).toHaveBeenCalledWith("/tmp/codetrail.sqlite");
    expect(mockInitializeBookmarkStore).toHaveBeenCalledWith("/tmp/codetrail.sqlite.bookmarks");
    expect(mockWorkerIndexingRunner).toHaveBeenCalledWith(
      "/tmp/codetrail.sqlite",
      expect.objectContaining({
        bookmarksDbPath: "/tmp/codetrail.sqlite.bookmarks",
        getEnabledProviders: expect.any(Function),
        getSystemMessageRegexRules: expect.any(Function),
      }),
    );
    expect(mockRegisterIpcHandlers).toHaveBeenCalledOnce();
    expect(getRequiredHandler(handlers, "app:getHealth")({})).toEqual({
      status: "ok",
      version: "0.1.0",
    });
    expect(getRequiredHandler(handlers, "db:getSchemaVersion")({})).toEqual({ schemaVersion: 7 });

    const settings = getRequiredHandler(handlers, "app:getSettingsInfo")({}) as {
      storage: {
        settingsFile: string;
        cacheDir: string;
        databaseFile: string;
        bookmarksDatabaseFile: string;
        userDataDir: string;
      };
      discovery: {
        providers: Array<{
          provider: string;
          label: string;
          paths: Array<{
            key: string;
            label: string;
            value: string;
            watch: boolean;
          }>;
        }>;
      };
    };
    expect(settings.storage).toEqual({
      settingsFile: "/tmp/state.json",
      cacheDir: "/tmp/session-data",
      databaseFile: "/tmp/codetrail.sqlite",
      bookmarksDatabaseFile: "/tmp/codetrail.sqlite.bookmarks",
      userDataDir: "/tmp/user-data",
    });
    expect(settings.discovery).toEqual(
      createSettingsInfoFixture({
        homeDir: "/Users/test",
        pathValues: {
          claudeRoot: "/claude/root",
          codexRoot: "/codex/root",
          geminiRoot: "/gemini/root",
          cursorRoot: "/cursor/root",
          copilotRoot: "/copilot/root",
        },
      }).discovery,
    );

    const projectPayload = { providers: ["claude"], query: "" };
    expect(getRequiredHandler(handlers, "projects:list")(projectPayload)).toEqual({
      projects: [
        {
          id: "project-1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          lastActivity: "2026-03-01T12:00:00.000Z",
        },
      ],
    });
    expect(mockListProjects).toHaveBeenCalledWith(projectPayload);

    const sessionsPayload = { projectId: "project-1", page: 2 };
    expect(getRequiredHandler(handlers, "sessions:list")(sessionsPayload)).toEqual({
      items: [{ id: "s1", ...sessionsPayload }],
      total: 1,
    });
    expect(mockListSessions).toHaveBeenCalledWith(sessionsPayload);

    const combinedDetailPayload = { projectId: "project-1", page: 0 };
    expect(
      getRequiredHandler(handlers, "projects:getCombinedDetail")(combinedDetailPayload),
    ).toEqual({
      projectId: "project-1",
      messages: [],
    });
    expect(mockGetProjectCombinedDetail).toHaveBeenCalledWith(combinedDetailPayload);

    const detailPayload = { id: "session-99" };
    expect(getRequiredHandler(handlers, "sessions:getDetail")(detailPayload)).toEqual({
      id: "session-99",
      messages: [],
    });
    expect(mockGetSessionDetail).toHaveBeenCalledWith(detailPayload);

    const bookmarksPayload = { projectId: "project-1", limit: 3 };
    expect(getRequiredHandler(handlers, "bookmarks:listProject")(bookmarksPayload)).toEqual({
      items: [{ id: "b1", ...bookmarksPayload }],
      total: 1,
    });
    expect(mockListProjectBookmarks).toHaveBeenCalledWith(bookmarksPayload);

    const togglePayload = { sessionId: "s1", bookmarked: true };
    expect(getRequiredHandler(handlers, "bookmarks:toggle")(togglePayload)).toEqual({
      bookmarked: true,
    });
    expect(mockToggleBookmark).toHaveBeenCalledWith(togglePayload);

    const searchPayload = { query: "error", limit: 20 };
    expect(getRequiredHandler(handlers, "search:query")(searchPayload)).toEqual({
      items: [
        {
          id: "m1",
          ...searchPayload,
          providers: ["claude", "codex", "gemini", "cursor", "copilot"],
        },
      ],
      total: 1,
    });
    expect(mockRunSearchQuery).toHaveBeenCalledWith({
      ...searchPayload,
      providers: ["claude", "codex", "gemini", "cursor", "copilot"],
    });

    await expect(getRequiredHandler(handlers, "indexer:refresh")({ force: true })).resolves.toEqual(
      {
        jobId: "job-1",
      },
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
      }),
      {
        source: "manual_force_reindex",
      },
    );
    expect(getRequiredHandler(handlers, "indexer:getStatus")({})).toEqual({
      running: false,
      queuedJobs: 0,
      activeJobId: null,
      completedJobs: 0,
    });
  });

  it("manages path actions for files, directories and fallback errors", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const openInFileManager = getRequiredHandler(handlers, "path:openInFileManager");

    mockStat.mockResolvedValueOnce({ isFile: () => true });
    await expect(openInFileManager({ path: "/workspace/project-one/file.txt" })).resolves.toEqual({
      ok: true,
      error: null,
    });
    expect(mockShowItemInFolder).toHaveBeenCalledWith("/workspace/project-one/file.txt");

    mockStat.mockResolvedValueOnce({ isFile: () => false });
    mockOpenPath.mockResolvedValueOnce("");
    await expect(openInFileManager({ path: "/workspace/project-one/folder" })).resolves.toEqual({
      ok: true,
      error: null,
    });
    expect(mockOpenPath).toHaveBeenCalledWith("/workspace/project-one/folder");

    mockStat.mockRejectedValueOnce(new Error("ENOENT"));
    mockOpenPath.mockResolvedValueOnce("permission denied");
    await expect(openInFileManager({ path: "/workspace/project-one/missing" })).resolves.toEqual({
      ok: false,
      error: "permission denied",
    });

    await expect(openInFileManager({ path: "/private/etc/passwd" })).resolves.toEqual({
      ok: false,
      error: "Path is outside indexed projects and app storage roots.",
    });

    mockRealpath.mockResolvedValueOnce("/private/etc/passwd");
    await expect(
      openInFileManager({ path: "/workspace/project-one/symlink-passwd" }),
    ).resolves.toEqual({
      ok: false,
      error: "Path is outside indexed projects and app storage roots.",
    });
  });

  it("hydrates and persists pane state through ui handlers", async () => {
    const appStateStore: Pick<
      AppStateStore,
      "getFilePath" | "getPaneState" | "setPaneState" | "getIndexingState" | "setIndexingState"
    > = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => paneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      setPaneState,
      setIndexingState,
    };

    await bootstrapMainProcess({
      appStateStore: appStateStore as AppStateStore,
      runStartupIndexing: false,
    });

    expect(getRequiredHandler(handlers, "ui:getPaneState")({})).toEqual({
      projectPaneWidth: 220,
      sessionPaneWidth: 480,
      projectPaneCollapsed: false,
      sessionPaneCollapsed: true,
      projectProviders: ["claude", "codex"],
      historyCategories: ["assistant"],
      expandedByDefaultCategories: ["assistant", "tool_use"],
      searchProviders: ["claude"],
      theme: "dark",
      monoFontFamily: "droid_sans_mono",
      regularFontFamily: "inter",
      monoFontSize: "13px",
      regularFontSize: "14px",
      useMonospaceForAllMessages: true,
      preferredAutoRefreshStrategy: "watch-5s",
      selectedProjectId: "project-1",
      selectedSessionId: "session-1",
      historyMode: "bookmarks",
      projectSortDirection: "desc",
      sessionSortDirection: "desc",
      messageSortDirection: "asc",
      bookmarkSortDirection: "asc",
      projectAllSortDirection: "desc",
      sessionPage: 2,
      sessionScrollTop: 180,
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
      },
    });
    expect(getRequiredHandler(handlers, "indexer:getConfig")({})).toEqual({
      enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
      removeMissingSessionsDuringIncrementalIndexing: false,
    });

    const updated = {
      ...paneState,
      projectPaneWidth: 300,
      sessionPaneWidth: 520,
      historyMode: "session" as const,
      sessionPage: 4,
    };
    expect(getRequiredHandler(handlers, "ui:setPaneState")(updated)).toEqual({
      ok: true,
    });
    expect(setPaneState).toHaveBeenCalledWith(updated);
  });

  it("filters queries and watcher roots to enabled providers and runs a full incremental refresh on provider changes", async () => {
    const currentPaneState: PaneState = {
      ...paneState,
      projectProviders: ["claude", "cursor"],
      searchProviders: ["claude", "cursor"],
    };
    let currentIndexingState = {
      enabledProviders: ["claude", "cursor"] as Provider[],
      removeMissingSessionsDuringIncrementalIndexing: false,
    };
    const appStateStore: Pick<
      AppStateStore,
      "getFilePath" | "getPaneState" | "setPaneState" | "getIndexingState" | "setIndexingState"
    > = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => currentPaneState,
      setPaneState: vi.fn(),
      getIndexingState: () => currentIndexingState,
      setIndexingState: vi.fn((value) => {
        currentIndexingState = value;
      }),
    };

    await bootstrapMainProcess({
      appStateStore: appStateStore as AppStateStore,
      runStartupIndexing: false,
    });

    getRequiredHandler(handlers, "projects:list")({ query: "" });
    expect(mockListProjects).toHaveBeenLastCalledWith({
      query: "",
      providers: ["claude", "cursor"],
    });

    getRequiredHandler(handlers, "search:query")({ query: "bug", limit: 20 });
    expect(mockRunSearchQuery).toHaveBeenLastCalledWith({
      query: "bug",
      limit: 20,
      providers: ["claude", "cursor"],
    });

    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    await expect(startWatcher({ debounceMs: 3000 })).resolves.toMatchObject({
      ok: true,
      watchedRoots: ["/claude/root", "/cursor/root"],
    });

    mockEnqueue.mockClear();
    await expect(
      getRequiredHandler(
        handlers,
        "indexer:setConfig",
      )({
        enabledProviders: ["claude", "codex", "cursor"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(mockFileWatcherInstances.at(-1)?.roots).toEqual([
      "/claude/root",
      "/codex/root",
      "/cursor/root",
    ]);
    expect(mockPurgeProviders).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith({ force: false }, { source: "manual_incremental" });
  });

  it("purges disabled providers and then runs a full incremental refresh", async () => {
    const currentPaneState: PaneState = {
      ...paneState,
      projectProviders: ["claude", "codex", "cursor"],
      searchProviders: ["claude", "codex", "cursor"],
    };
    let currentIndexingState = {
      enabledProviders: ["claude", "codex", "cursor"] as Provider[],
      removeMissingSessionsDuringIncrementalIndexing: false,
    };
    const appStateStore: Pick<
      AppStateStore,
      "getFilePath" | "getPaneState" | "setPaneState" | "getIndexingState" | "setIndexingState"
    > = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => currentPaneState,
      setPaneState: vi.fn(),
      getIndexingState: () => currentIndexingState,
      setIndexingState: vi.fn((value) => {
        currentIndexingState = value;
      }),
    };

    await bootstrapMainProcess({
      appStateStore: appStateStore as AppStateStore,
      runStartupIndexing: false,
    });

    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    await expect(startWatcher({ debounceMs: 3000 })).resolves.toMatchObject({
      ok: true,
      watchedRoots: ["/claude/root", "/codex/root", "/cursor/root"],
    });

    mockEnqueue.mockClear();
    mockPurgeProviders.mockClear();

    await expect(
      getRequiredHandler(
        handlers,
        "indexer:setConfig",
      )({
        enabledProviders: ["claude"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(mockFileWatcherInstances.at(-1)?.roots).toEqual(["/claude/root"]);
    expect(mockPurgeProviders).toHaveBeenCalledWith(["codex", "cursor"], {
      source: "manual_incremental",
    });
    expect(mockEnqueue).toHaveBeenCalledWith({ force: false }, { source: "manual_incremental" });
  });

  it("starts macOS watchers with kqueue and runs a catch-up incremental scan after startup", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      await bootstrapMainProcess({ runStartupIndexing: false });

      const startWatcher = getRequiredHandler(handlers, "watcher:start");
      const result = (await startWatcher({ debounceMs: 3000 })) as {
        ok: boolean;
        watchedRoots: string[];
        backend: string;
      };

      expect(result).toEqual({
        ok: true,
        watchedRoots: [
          "/claude/root",
          "/codex/root",
          "/gemini/root",
          "/Users/test/.gemini/history",
          "/cursor/root",
          "/copilot/root",
        ],
        backend: "kqueue",
      });
      expect(mockFileWatcherService).toHaveBeenCalledWith(
        [
          "/claude/root",
          "/codex/root",
          "/gemini/root",
          "/Users/test/.gemini/history",
          "/cursor/root",
          "/copilot/root",
        ],
        expect.any(Function),
        expect.objectContaining({
          debounceMs: 3000,
          subscribeOptions: { backend: "kqueue" },
        }),
      );
      expect(mockFileWatcherInstances[0]?.start).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith({ force: false }, { source: "watch_initial_scan" });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("falls back to the default watcher backend when kqueue startup fails on macOS", async () => {
    const originalPlatform = process.platform;
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      await bootstrapMainProcess({ runStartupIndexing: false });
      mockFileWatcherService
        .mockImplementationOnce(
          (
            roots: string[],
            onFilesChanged: (batch: {
              changedPaths: string[];
              requiresFullScan: boolean;
            }) => Promise<void>,
            options: Record<string, unknown> = {},
          ) => {
            const instance = {
              roots,
              options,
              onFilesChanged,
              start: vi.fn(async () => {
                throw new Error("kqueue unavailable");
              }),
              stop: vi.fn(async () => {}),
              getWatchedRoots: vi.fn(() => roots),
              getStatus: vi.fn(() => ({ running: false, processing: false, pendingPathCount: 0 })),
            };
            mockFileWatcherInstances.push(instance);
            return instance;
          },
        )
        .mockImplementationOnce(
          (
            roots: string[],
            onFilesChanged: (batch: {
              changedPaths: string[];
              requiresFullScan: boolean;
            }) => Promise<void>,
            options: Record<string, unknown> = {},
          ) => {
            const instance = {
              roots,
              options,
              onFilesChanged,
              start: vi.fn(async () => {}),
              stop: vi.fn(async () => {}),
              getWatchedRoots: vi.fn(() => roots),
              getStatus: vi.fn(() => ({ running: false, processing: false, pendingPathCount: 0 })),
            };
            mockFileWatcherInstances.push(instance);
            return instance;
          },
        );

      const startWatcher = getRequiredHandler(handlers, "watcher:start");
      const result = (await startWatcher({ debounceMs: 1000 })) as {
        ok: boolean;
        watchedRoots: string[];
        backend: string;
      };

      expect(result.backend).toBe("default");
      expect(mockFileWatcherService).toHaveBeenNthCalledWith(
        1,
        [
          "/claude/root",
          "/codex/root",
          "/gemini/root",
          "/Users/test/.gemini/history",
          "/cursor/root",
          "/copilot/root",
        ],
        expect.any(Function),
        expect.objectContaining({
          debounceMs: 1000,
          subscribeOptions: { backend: "kqueue" },
        }),
      );
      expect(mockFileWatcherService).toHaveBeenNthCalledWith(
        2,
        [
          "/claude/root",
          "/codex/root",
          "/gemini/root",
          "/Users/test/.gemini/history",
          "/cursor/root",
          "/copilot/root",
        ],
        expect.any(Function),
        expect.objectContaining({
          debounceMs: 1000,
        }),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[codetrail] Failed to start kqueue watcher on macOS, falling back to default backend",
        expect.any(Error),
      );
    } finally {
      consoleWarnSpy.mockRestore();
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });


  it("reports watcher queue status through IPC", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });

    await expect(getRequiredHandler(handlers, "watcher:getStatus")({})).resolves.toEqual({
      running: false,
      processing: false,
      pendingPathCount: 0,
    });

    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }
    firstWatcher.getStatus = vi.fn(() => ({
      running: true,
      processing: false,
      pendingPathCount: 2,
    }));

    await expect(getRequiredHandler(handlers, "watcher:getStatus")({})).resolves.toEqual({
      running: true,
      processing: false,
      pendingPathCount: 2,
    });
  });

  it("uses targeted indexing for tracked file watcher batches", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    mockEnqueue.mockClear();
    mockEnqueueChangedFiles.mockClear();

    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }

    await firstWatcher.onFilesChanged({
      changedPaths: ["/codex/root/2026/03/16/session-1.jsonl"],
      requiresFullScan: false,
    });

    expect(mockEnqueueChangedFiles).toHaveBeenCalledWith(
      ["/codex/root/2026/03/16/session-1.jsonl"],
      { source: "watch_targeted" },
    );
    expect(mockEnqueue).not.toHaveBeenCalledWith({ force: false }, expect.anything());
  });

  it("promotes structural watcher batches to a full incremental scan", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    mockEnqueue.mockClear();
    mockEnqueueChangedFiles.mockClear();

    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }

    await firstWatcher.onFilesChanged({
      changedPaths: [],
      requiresFullScan: true,
    });

    expect(mockEnqueue).toHaveBeenCalledWith(
      { force: false },
      { source: "watch_fallback_incremental" },
    );
    expect(mockEnqueueChangedFiles).not.toHaveBeenCalled();
  });

  it("handles zoom get/in/out/reset and explicit percent actions", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });

    const sender = {
      zoomFactor: 1.21,
      getZoomFactor: vi.fn(function (this: { zoomFactor: number }) {
        return this.zoomFactor;
      }),
      setZoomFactor: vi.fn(function (this: { zoomFactor: number }, value: number) {
        this.zoomFactor = value;
      }),
    };
    const event = { sender };

    expect(getRequiredHandler(handlers, "ui:getZoom")({}, event)).toEqual({ percent: 121 });

    expect(getRequiredHandler(handlers, "ui:setZoom")({ action: "in" }, event)).toEqual({
      percent: 131,
    });
    expect(sender.setZoomFactor).toHaveBeenCalledWith(1.31);

    expect(getRequiredHandler(handlers, "ui:setZoom")({ action: "out" }, event)).toEqual({
      percent: 121,
    });
    expect(sender.setZoomFactor).toHaveBeenCalledWith(1.21);

    expect(getRequiredHandler(handlers, "ui:setZoom")({ action: "reset" }, event)).toEqual({
      percent: 100,
    });
    expect(sender.setZoomFactor).toHaveBeenCalledWith(1);

    expect(getRequiredHandler(handlers, "ui:setZoom")({ percent: 104 }, event)).toEqual({
      percent: 104,
    });
    expect(sender.setZoomFactor).toHaveBeenCalledWith(1.04);

    expect(getRequiredHandler(handlers, "ui:setZoom")({ percent: 300 }, event)).toEqual({
      percent: 175,
    });
    expect(sender.setZoomFactor).toHaveBeenCalledWith(1.75);
  });

  it("triggers startup indexing by default and logs startup failures", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await bootstrapMainProcess();
      expect(mockEnqueue).toHaveBeenCalledWith({ force: false }, { source: "startup_incremental" });

      mockEnqueue.mockRejectedValueOnce(new Error("index boom"));
      await bootstrapMainProcess({ dbPath: "/tmp/next.sqlite" });
      await Promise.resolve();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[codetrail] startup incremental indexing failed",
        expect.any(Error),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("closes previous query service on rebootstrap and supports explicit shutdown", async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const baseService = {
      listProjects: vi.fn(),
      getProjectCombinedDetail: vi.fn(),
      listSessions: vi.fn(),
      getSessionDetail: vi.fn(),
      listProjectBookmarks: vi.fn(),
      toggleBookmark: vi.fn(),
      runSearchQuery: vi.fn(),
    };

    mockCreateQueryService
      .mockReturnValueOnce({ ...baseService, close: firstClose })
      .mockReturnValueOnce({ ...baseService, close: secondClose });

    await bootstrapMainProcess({ dbPath: "/tmp/a.sqlite", runStartupIndexing: false });
    await bootstrapMainProcess({ dbPath: "/tmp/b.sqlite", runStartupIndexing: false });
    expect(firstClose).toHaveBeenCalledTimes(1);

    await shutdownMainProcess();
    expect(secondClose).toHaveBeenCalledTimes(1);
    await shutdownMainProcess();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to default schema version when bootstrap omits a schema value", async () => {
    mockInitializeDatabase.mockReturnValueOnce({
      schemaVersion: undefined as number | undefined,
      tables: [],
    });
    const result = await bootstrapMainProcess({ runStartupIndexing: false });
    expect(result).toEqual({ schemaVersion: 42, tableCount: 0 });
  });
});
