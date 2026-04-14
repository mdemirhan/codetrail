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
  mockAccess,
  mockMkdir,
  mockMkdtemp,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockRm,
  mockStat,
  mockUnlink,
  mockWriteFile,
  mockRealpath,
  mockOpenPath,
  mockShowItemInFolder,
  mockShowSaveDialog,
  mockShowOpenDialog,
  mockBrowserWindowFromWebContents,
  mockBrowserWindowGetAllWindows,
  mockListProjects,
  mockGetProjectById,
  mockGetProjectCombinedDetail,
  mockListSessions,
  mockGetSessionDetail,
  mockListProjectBookmarks,
  mockToggleBookmark,
  mockRunSearchQuery,
  mockDeleteProject,
  mockDeleteSession,
  mockQueryServiceClose,
  mockFileWatcherService,
  mockFileWatcherInstances,
  mockLiveSessionStore,
  mockLiveSessionStoreInstances,
  mockWorkerIndexingRunnerDependencyRef,
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
  const liveSessionStoreInstances: Array<{
    prepareClaudeHookLogForAppStart: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    handleWatcherBatch: ReturnType<typeof vi.fn>;
    takeIndexingPrefetchedJsonlChunks: ReturnType<typeof vi.fn>;
    noteStructuralInvalidation: ReturnType<typeof vi.fn>;
    hasStructuralInvalidationPending: ReturnType<typeof vi.fn>;
    getStructuralInvalidationObservedAtMs: ReturnType<typeof vi.fn>;
    catchUpTrackedTranscriptsAfterWatcherRestart: ReturnType<typeof vi.fn>;
    repairRecentSessionsAfterIndexing: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
    installClaudeHooks: ReturnType<typeof vi.fn>;
    removeClaudeHooks: ReturnType<typeof vi.fn>;
  }> = [];
  const workerIndexingRunnerDependencyRef: {
    current: {
      onJobSettled?: (event: {
        source: string;
        request: { kind: "incremental" | "changedFiles" | "maintenance" };
        startedAtMs: number;
        finishedAtMs: number;
        durationMs: number;
        success: boolean;
      }) => void | Promise<void>;
    } | null;
  } = { current: null };

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
    mockAccess: vi.fn(async () => undefined),
    mockMkdir: vi.fn(async () => undefined),
    mockMkdtemp: vi.fn(async () => "/tmp/codetrail-test"),
    mockReadFile: vi.fn(async () => ""),
    mockReaddir: vi.fn(async () => []),
    mockRename: vi.fn(async () => undefined),
    mockRm: vi.fn(async () => undefined),
    mockStat: vi.fn<() => Promise<{ isFile: () => boolean }>>(async () => ({
      isFile: () => false,
    })),
    mockUnlink: vi.fn(async () => undefined),
    mockWriteFile: vi.fn(async () => undefined),
    mockRealpath: vi.fn(async (pathValue: string) => pathValue),
    mockOpenPath: vi.fn(async () => ""),
    mockShowItemInFolder: vi.fn(),
    mockShowSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
    mockShowOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    mockBrowserWindowFromWebContents: vi.fn(() => null),
    mockBrowserWindowGetAllWindows: vi.fn(() => []),
    mockListProjects: vi.fn(() => ({
      projects: [
        {
          id: "project-1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          messageCount: 1,
          lastActivity: "2026-03-01T12:00:00.000Z",
        },
      ],
    })),
    mockGetProjectById: vi.fn((projectId: string) =>
      projectId === "project-1"
        ? {
            id: "project-1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 1,
            lastActivity: "2026-03-01T12:00:00.000Z",
          }
        : null,
    ),
    mockGetProjectCombinedDetail: vi.fn((payload) => ({
      projectId: payload.projectId,
      messages: [],
    })),
    mockListSessions: vi.fn((payload) => ({ items: [{ id: "s1", ...payload }], total: 1 })),
    mockGetSessionDetail: vi.fn((payload) => ({ id: payload.id, messages: [] })),
    mockListProjectBookmarks: vi.fn((payload) => ({ items: [{ id: "b1", ...payload }], total: 1 })),
    mockToggleBookmark: vi.fn((payload) => ({ bookmarked: payload.bookmarked })),
    mockRunSearchQuery: vi.fn((payload) => ({ items: [{ id: "m1", ...payload }], total: 1 })),
    mockDeleteProject: vi.fn(() => ({
      deleted: true,
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedSessionCount: 1,
      removedMessageCount: 1,
      removedBookmarkCount: 0,
    })),
    mockDeleteSession: vi.fn(() => ({
      deleted: true,
      projectId: "project-1",
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedMessageCount: 1,
      removedBookmarkCount: 0,
    })),
    mockQueryServiceClose: vi.fn(),
    mockFileWatcherInstances: fileWatcherInstances,
    mockLiveSessionStoreInstances: liveSessionStoreInstances,
    mockWorkerIndexingRunnerDependencyRef: workerIndexingRunnerDependencyRef,
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
    mockLiveSessionStore: vi.fn(() => {
      const instance = {
        prepareClaudeHookLogForAppStart: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        handleWatcherBatch: vi.fn(async () => undefined),
        takeIndexingPrefetchedJsonlChunks: vi.fn(() => []),
        noteStructuralInvalidation: vi.fn(),
        hasStructuralInvalidationPending: vi.fn(() => false),
        getStructuralInvalidationObservedAtMs: vi.fn(() => null),
        catchUpTrackedTranscriptsAfterWatcherRestart: vi.fn(async () => ({
          processedTrackedFileCount: 0,
        })),
        repairRecentSessionsAfterIndexing: vi.fn(async () => ({
          ran: true,
          candidateCount: 0,
          recoveredSessionCount: 0,
          repairedTrackedSessionCount: 0,
          consumedStructuralInvalidation: false,
          staleCandidateCountAfterRepair: 0,
        })),
        snapshot: vi.fn(() => ({
          enabled: true,
          revision: 0,
          updatedAt: "2026-04-11T10:00:00.000Z",
          instrumentationEnabled: false,
          providerCounts: {
            claude: 0,
            codex: 0,
            gemini: 0,
            cursor: 0,
            copilot: 0,
            copilot_cli: 0,
          },
          sessions: [],
          claudeHookState: {
            settingsPath: "/Users/test/.claude/settings.json",
            logPath: "/tmp/user-data/live-status/claude-hooks.jsonl",
            installed: false,
            managed: false,
            managedEventNames: [],
            missingEventNames: [],
            lastError: null,
          },
        })),
        installClaudeHooks: vi.fn(async () => ({
          settingsPath: "/Users/test/.claude/settings.json",
          logPath: "/tmp/user-data/live-status/claude-hooks.jsonl",
          installed: true,
          managed: true,
          managedEventNames: [],
          missingEventNames: [],
          lastError: null,
        })),
        removeClaudeHooks: vi.fn(async () => ({
          settingsPath: "/Users/test/.claude/settings.json",
          logPath: "/tmp/user-data/live-status/claude-hooks.jsonl",
          installed: false,
          managed: false,
          managedEventNames: [],
          missingEventNames: [],
          lastError: null,
        })),
      };
      liveSessionStoreInstances.push(instance);
      return instance;
    }),
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
      copilotCliRoot: "/copilot-cli/root",
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

vi.mock("./liveSessionStore", () => ({
  LiveSessionStore: mockLiveSessionStore,
}));

vi.mock("node:fs/promises", () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  mkdtemp: mockMkdtemp,
  readFile: mockReadFile,
  realpath: mockRealpath,
  readdir: mockReaddir,
  rename: mockRename,
  rm: mockRm,
  stat: mockStat,
  unlink: mockUnlink,
  writeFile: mockWriteFile,
}));

vi.mock("electron", () => ({
  app: {
    getPath: mockGetPath,
    getVersion: mockGetVersion,
  },
  ipcMain: {},
  BrowserWindow: {
    fromWebContents: mockBrowserWindowFromWebContents,
    getAllWindows: mockBrowserWindowGetAllWindows,
  },
  dialog: {
    showSaveDialog: mockShowSaveDialog,
    showOpenDialog: mockShowOpenDialog,
  },
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

function createWatcherInvokeEvent(senderId: number) {
  let destroyedListener: (() => void) | null = null;
  const sender = {
    id: senderId,
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "destroyed") {
        destroyedListener = listener;
      }
      return sender;
    }),
  };

  return {
    sender,
    event: { sender },
    destroy: () => {
      destroyedListener?.();
    },
  };
}

function getLastLiveSessionStore() {
  const instance = mockLiveSessionStoreInstances.at(-1);
  if (!instance) {
    throw new Error("Expected LiveSessionStore instance");
  }
  return instance;
}

async function settleIndexingJob(event: {
  source: string;
  request: { kind: "incremental" | "changedFiles" | "maintenance" };
  startedAtMs?: number;
  finishedAtMs?: number;
  durationMs?: number;
  success: boolean;
}) {
  const onJobSettled = mockWorkerIndexingRunnerDependencyRef.current?.onJobSettled;
  if (!onJobSettled) {
    throw new Error("Missing WorkerIndexingRunner onJobSettled dependency");
  }
  const startedAtMs = event.startedAtMs ?? Date.parse("2026-04-11T09:00:00.000Z");
  const durationMs = event.durationMs ?? 5;
  await onJobSettled({
    startedAtMs,
    finishedAtMs: event.finishedAtMs ?? startedAtMs + durationMs,
    durationMs,
    ...event,
  });
}

describe("bootstrapMainProcess", () => {
  let handlers: HandlerMap;
  let flush: ReturnType<typeof vi.fn>;
  let setPaneState: ReturnType<typeof vi.fn>;
  let setPaneStateRuntimeOnly: ReturnType<typeof vi.fn>;
  let setIndexingState: ReturnType<typeof vi.fn>;
  type AppStateStoreMock = Pick<
    AppStateStore,
    | "getFilePath"
    | "getPaneState"
    | "setPaneState"
    | "setPaneStateRuntimeOnly"
    | "getIndexingState"
    | "setIndexingState"
    | "flush"
  >;
  const paneState: PaneState = {
    projectPaneWidth: 220,
    sessionPaneWidth: 480,
    projectPaneCollapsed: false,
    sessionPaneCollapsed: true,
    singleClickFoldersExpand: true,
    singleClickProjectsExpand: false,
    projectProviders: ["claude", "codex"],
    historyCategories: ["assistant"],
    expandedByDefaultCategories: ["assistant", "tool_use"],
    turnViewCategories: ["assistant"],
    turnViewExpandedByDefaultCategories: ["assistant", "tool_use"],
    turnViewCombinedChangesExpanded: false,
    searchProviders: ["claude"],
    liveWatchEnabled: true,
    liveWatchRowHasBackground: true,
    claudeHooksPrompted: false,
    theme: "dark",
    monoFontFamily: "droid_sans_mono",
    regularFontFamily: "inter",
    monoFontSize: "13px",
    regularFontSize: "14px",
    messagePageSize: 50,
    useMonospaceForAllMessages: true,
    preferredAutoRefreshStrategy: "watch-5s",
    selectedProjectId: "project-1",
    selectedSessionId: "session-1",
    historyMode: "bookmarks",
    historyVisualization: "bookmarks",
    historyDetailMode: "flat",
    projectSortDirection: "desc",
    sessionSortDirection: "desc",
    messageSortDirection: "asc",
    bookmarkSortDirection: "asc",
    projectAllSortDirection: "desc",
    turnViewSortDirection: "desc",
    sessionPage: 2,
    sessionScrollTop: 180,
    systemMessageRegexRules: {
      claude: ["^<command-name>"],
      codex: ["^<environment_context>"],
      gemini: [],
      cursor: [],
      copilot: [],
      copilot_cli: [],
    },
  };

  beforeEach(() => {
    handlers = {};
    flush = vi.fn();
    setPaneState = vi.fn();
    setPaneStateRuntimeOnly = vi.fn();
    setIndexingState = vi.fn();
    vi.clearAllMocks();
    mockFileWatcherInstances.length = 0;
    mockLiveSessionStoreInstances.length = 0;
    mockWorkerIndexingRunnerDependencyRef.current = null;
    void shutdownMainProcess();

    mockWorkerIndexingRunner.mockImplementation((_dbPath: string, dependencies?: unknown) => {
      mockWorkerIndexingRunnerDependencyRef.current = (dependencies ?? null) as {
        onJobSettled?: (event: {
          source: string;
          request: { kind: "incremental" | "changedFiles" | "maintenance" };
          startedAtMs: number;
          finishedAtMs: number;
          durationMs: number;
          success: boolean;
        }) => void | Promise<void>;
      } | null;
      return {
        enqueue: mockEnqueue,
        purgeProviders: mockPurgeProviders,
        enqueueChangedFiles: mockEnqueueChangedFiles,
        getStatus: mockGetStatus,
      };
    });
    mockCreateQueryService.mockImplementation(() => ({
      listProjects: mockListProjects,
      getProjectById: mockGetProjectById,
      getProjectCombinedDetail: mockGetProjectCombinedDetail,
      listSessions: mockListSessions,
      listSessionsMany: vi.fn(),
      getSessionDetail: mockGetSessionDetail,
      listProjectBookmarks: mockListProjectBookmarks,
      getBookmarkStates: vi.fn(),
      toggleBookmark: mockToggleBookmark,
      runSearchQuery: mockRunSearchQuery,
      listRecentLiveSessionFiles: vi.fn(() => []),
      deleteProject: mockDeleteProject,
      deleteSession: mockDeleteSession,
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
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => paneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      flush,
      setPaneState,
      setPaneStateRuntimeOnly,
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
          copilotCliRoot: "/copilot-cli/root",
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
          messageCount: 1,
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

  it("resolves project-scoped force reindex requests before enqueueing", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });

    await expect(
      getRequiredHandler(
        handlers,
        "indexer:refresh",
      )({
        force: true,
        projectId: "project-1",
      }),
    ).resolves.toEqual({
      jobId: "job-1",
    });

    expect(mockEnqueue).toHaveBeenCalledWith(
      {
        force: true,
        projectScope: {
          provider: "claude",
          projectPath: "/workspace/project-one",
        },
      },
      {
        source: "manual_project_force_reindex",
      },
    );
  });

  it("rejects stale project-scoped reindex requests", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    mockGetProjectById.mockReturnValueOnce(null);

    await expect(
      getRequiredHandler(
        handlers,
        "indexer:refresh",
      )({
        force: true,
        projectId: "missing-project",
      }),
    ).rejects.toThrow("This project no longer exists in the database.");
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

  it("opens a native picker for external tool commands and accepts macOS app bundles", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const pickCommand = getRequiredHandler(handlers, "dialog:pickExternalToolCommand");

    mockShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/System/Applications/TextEdit.app"] as string[],
    });
    mockStat.mockResolvedValueOnce({ isFile: () => false });

    await expect(pickCommand({})).resolves.toEqual({
      canceled: false,
      path: "/System/Applications/TextEdit.app",
      error: null,
    });
  });

  it("honors editor:listAvailable external tool overrides even without persisted pane state", async () => {
    await bootstrapMainProcess({
      appStateStore: {
        getFilePath: () => "/tmp/state.json",
        getPaneState: () => null,
        getIndexingState: () => null,
      } as AppStateStore,
      runStartupIndexing: false,
    });

    const result = await getRequiredHandler(
      handlers,
      "editor:listAvailable",
    )({
      externalTools: [
        {
          id: "custom:1",
          kind: "custom",
          label: "Custom Editor",
          appId: null,
          command: "",
          editorArgs: ["{file}"],
          diffArgs: ["{left}", "{right}"],
          enabledForEditor: true,
          enabledForDiff: false,
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        editors: expect.arrayContaining([
          expect.objectContaining({
            id: "custom:1",
            kind: "custom",
            label: "Custom Editor",
          }),
        ]),
      }),
    );
  });

  it("rejects relative file paths for editor:open", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });

    await expect(
      getRequiredHandler(
        handlers,
        "editor:open",
      )({
        kind: "file",
        filePath: "../outside.txt",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "File path must be absolute.",
    });
  });

  it("hydrates pane state through ui handlers", async () => {
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => paneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      flush,
      setPaneState,
      setPaneStateRuntimeOnly,
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
      singleClickFoldersExpand: true,
      singleClickProjectsExpand: false,
      hideSessionsPaneInTreeView: null,
      projectProviders: ["claude", "codex"],
      historyCategories: ["assistant"],
      expandedByDefaultCategories: ["assistant", "tool_use"],
      turnViewCategories: ["assistant"],
      turnViewExpandedByDefaultCategories: ["assistant", "tool_use"],
      turnViewCombinedChangesExpanded: false,
      searchProviders: ["claude"],
      theme: "dark",
      darkShikiTheme: null,
      lightShikiTheme: null,
      monoFontFamily: "droid_sans_mono",
      regularFontFamily: "inter",
      monoFontSize: "13px",
      regularFontSize: "14px",
      messagePageSize: 50,
      useMonospaceForAllMessages: true,
      autoHideMessageActions: null,
      expandPreviewOnHiddenActions: null,
      autoHideViewerHeaderActions: null,
      defaultViewerWrapMode: null,
      defaultDiffViewMode: null,
      collapseMultiFileToolDiffs: null,
      preferredExternalEditor: null,
      preferredExternalDiffTool: null,
      terminalAppCommand: null,
      externalTools: null,
      liveWatchEnabled: true,
      liveWatchRowHasBackground: true,
      claudeHooksPrompted: false,
      currentAutoRefreshStrategy: null,
      preferredAutoRefreshStrategy: "watch-5s",
      selectedProjectId: "project-1",
      selectedSessionId: "session-1",
      historyMode: "bookmarks",
      historyVisualization: "bookmarks",
      historyDetailMode: "flat",
      projectViewMode: null,
      projectSortField: null,
      projectSortDirection: "desc",
      sessionSortDirection: "desc",
      messageSortDirection: "asc",
      bookmarkSortDirection: "asc",
      projectAllSortDirection: "desc",
      turnViewSortDirection: "desc",
      sessionPage: 2,
      sessionScrollTop: 180,
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
        copilot_cli: [],
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
    expect(setPaneStateRuntimeOnly).toHaveBeenCalledWith(updated);
    expect(setPaneState).not.toHaveBeenCalled();
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
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => currentPaneState,
      flush,
      setPaneState: vi.fn(),
      setPaneStateRuntimeOnly: vi.fn(),
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

  it("updates pane state in memory without scheduling persistence from ui:setPaneState", async () => {
    const setPaneStatePersisted = vi.fn();
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => paneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      flush,
      setIndexingState: vi.fn(),
      setPaneState: setPaneStatePersisted,
      setPaneStateRuntimeOnly,
    };

    await bootstrapMainProcess({
      appStateStore: appStateStore as AppStateStore,
      runStartupIndexing: false,
    });

    const updated = {
      ...paneState,
      projectPaneWidth: 300,
      sessionPaneWidth: 520,
    };
    expect(getRequiredHandler(handlers, "ui:setPaneState")(updated)).toEqual({ ok: true });
    expect(setPaneStateRuntimeOnly).toHaveBeenCalledWith(updated);
    expect(setPaneStatePersisted).not.toHaveBeenCalled();
  });

  it("flushes immediately when durable live-watch flags change", async () => {
    let currentPaneState: PaneState = {
      ...paneState,
      liveWatchEnabled: false,
      liveWatchRowHasBackground: true,
      claudeHooksPrompted: false,
    };
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => currentPaneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      flush,
      setIndexingState: vi.fn(),
      setPaneState: vi.fn(),
      setPaneStateRuntimeOnly: vi.fn((value: PaneState) => {
        currentPaneState = value;
      }),
    };

    await bootstrapMainProcess({
      appStateStore: appStateStore as AppStateStore,
      runStartupIndexing: false,
    });

    expect(
      getRequiredHandler(
        handlers,
        "ui:setPaneState",
      )({
        ...currentPaneState,
        liveWatchEnabled: true,
      }),
    ).toEqual({ ok: true });
    expect(flush).toHaveBeenCalledTimes(1);

    expect(
      getRequiredHandler(
        handlers,
        "ui:setPaneState",
      )({
        ...currentPaneState,
        claudeHooksPrompted: true,
      }),
    ).toEqual({ ok: true });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("flushes app state immediately from app:flushState", async () => {
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => paneState,
      getIndexingState: () => ({
        enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
        removeMissingSessionsDuringIncrementalIndexing: false,
      }),
      flush,
      setIndexingState: vi.fn(),
      setPaneState: vi.fn(),
      setPaneStateRuntimeOnly: vi.fn(),
    };

    await bootstrapMainProcess({
      appStateStore: appStateStore as AppStateStore,
      runStartupIndexing: false,
    });

    expect(getRequiredHandler(handlers, "app:flushState")({})).toEqual({ ok: true });
    expect(flush).toHaveBeenCalledTimes(1);
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
    const appStateStore: AppStateStoreMock = {
      getFilePath: () => "/tmp/state.json",
      getPaneState: () => currentPaneState,
      flush,
      setPaneState: vi.fn(),
      setPaneStateRuntimeOnly: vi.fn(),
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
          "/copilot-cli/root",
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
          "/copilot-cli/root",
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
          "/copilot-cli/root",
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
          "/copilot-cli/root",
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

  it("deduplicates duplicate watcher starts from the same sender and keeps the watcher alive until the final stop", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    const stopWatcher = getRequiredHandler(handlers, "watcher:stop");
    const invokeEvent = createWatcherInvokeEvent(101);

    await startWatcher({ debounceMs: 3000 }, invokeEvent.event);
    expect(mockFileWatcherInstances).toHaveLength(1);
    expect(mockEnqueue).toHaveBeenCalledWith({ force: false }, { source: "watch_initial_scan" });

    mockEnqueue.mockClear();
    await startWatcher({ debounceMs: 3000 }, invokeEvent.event);

    expect(mockFileWatcherInstances).toHaveLength(1);
    expect(mockFileWatcherInstances[0]?.start).toHaveBeenCalledTimes(1);
    expect(mockFileWatcherInstances[0]?.stop).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();

    await stopWatcher({}, invokeEvent.event);
    expect(mockFileWatcherInstances[0]?.stop).not.toHaveBeenCalled();

    await stopWatcher({}, invokeEvent.event);
    expect(mockFileWatcherInstances[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("restarts the watcher when the active debounce changes", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    const invokeEvent = createWatcherInvokeEvent(202);

    await startWatcher({ debounceMs: 1000 }, invokeEvent.event);
    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected first watcher instance");
    }

    mockEnqueue.mockClear();
    await startWatcher({ debounceMs: 5000 }, invokeEvent.event);

    expect(firstWatcher.stop).toHaveBeenCalledTimes(1);
    expect(mockFileWatcherInstances).toHaveLength(2);
    expect(mockFileWatcherInstances[1]?.options).toEqual(
      expect.objectContaining({ debounceMs: 5000 }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith({ force: false }, { source: "watch_initial_scan" });
  });

  it("releases the sender lease when watcher startup fails", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    const stopWatcher = getRequiredHandler(handlers, "watcher:stop");
    const failedStartEvent = createWatcherInvokeEvent(250);
    const successfulStartEvent = createWatcherInvokeEvent(251);

    const createFailingWatcher = (
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
          throw new Error("watcher boot failed");
        }),
        stop: vi.fn(async () => {}),
        getWatchedRoots: vi.fn(() => roots),
        getStatus: vi.fn(() => ({ running: false, processing: false, pendingPathCount: 0 })),
      };
      mockFileWatcherInstances.push(instance);
      return instance;
    };

    mockFileWatcherService
      .mockImplementationOnce(createFailingWatcher)
      .mockImplementationOnce(createFailingWatcher);

    await expect(startWatcher({ debounceMs: 3000 }, failedStartEvent.event)).resolves.toEqual({
      ok: false,
      watchedRoots: [],
      backend: "default",
    });

    mockEnqueue.mockClear();
    await expect(startWatcher({ debounceMs: 3000 }, successfulStartEvent.event)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );

    const successfulWatcher = mockFileWatcherInstances.at(-1);
    if (!successfulWatcher) {
      throw new Error("Expected successful watcher instance");
    }

    await stopWatcher({}, successfulStartEvent.event);
    expect(successfulWatcher.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the watcher running while another sender still holds a lease", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    const stopWatcher = getRequiredHandler(handlers, "watcher:stop");
    const firstEvent = createWatcherInvokeEvent(301);
    const secondEvent = createWatcherInvokeEvent(302);

    await startWatcher({ debounceMs: 3000 }, firstEvent.event);
    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }

    await startWatcher({ debounceMs: 3000 }, secondEvent.event);
    expect(mockFileWatcherInstances).toHaveLength(1);

    await stopWatcher({}, firstEvent.event);
    expect(firstWatcher.stop).not.toHaveBeenCalled();

    await stopWatcher({}, secondEvent.event);
    expect(firstWatcher.stop).toHaveBeenCalledTimes(1);
  });

  it("releases all leases for a sender when its webContents is destroyed", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const startWatcher = getRequiredHandler(handlers, "watcher:start");
    const invokeEvent = createWatcherInvokeEvent(401);

    await startWatcher({ debounceMs: 3000 }, invokeEvent.event);
    await startWatcher({ debounceMs: 3000 }, invokeEvent.event);
    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }

    invokeEvent.destroy();
    await vi.waitFor(() => {
      expect(firstWatcher.stop).toHaveBeenCalledTimes(1);
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
      changedPaths: ["/codex/root/2026/03/16/SESSION-1.JSONL"],
      requiresFullScan: false,
    });

    expect(mockEnqueueChangedFiles).toHaveBeenCalledWith(
      ["/codex/root/2026/03/16/SESSION-1.JSONL"],
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

  it("restarts the kqueue watcher after structural fallback indexing settles and repairs with the structural baseline", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    const liveSessionStore = getLastLiveSessionStore();
    mockEnqueue.mockClear();
    liveSessionStore.noteStructuralInvalidation.mockClear();
    liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart.mockClear();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
    liveSessionStore.hasStructuralInvalidationPending.mockReturnValue(true);
    liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(
      Date.parse("2026-04-11T08:59:00.000Z"),
    );

    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }

    await firstWatcher.onFilesChanged({
      changedPaths: [],
      requiresFullScan: true,
    });

    expect(liveSessionStore.noteStructuralInvalidation).toHaveBeenCalledTimes(1);
    expect(liveSessionStore.noteStructuralInvalidation).toHaveBeenCalledWith(expect.any(Number));
    expect(mockEnqueue).toHaveBeenCalledWith(
      { force: false },
      { source: "watch_fallback_incremental" },
    );

    await settleIndexingJob({
      source: "watch_fallback_incremental",
      request: { kind: "incremental" },
      startedAtMs: Date.parse("2026-04-11T09:00:00.000Z"),
      success: true,
    });

    await vi.waitFor(() => {
      expect(mockFileWatcherInstances).toHaveLength(2);
      expect(firstWatcher.stop).toHaveBeenCalledWith({ flushPending: true });
      expect(liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart).toHaveBeenCalledTimes(
        1,
      );
      expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
    });
    expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledWith({
      minFileMtimeMs: Date.parse("2026-04-11T08:59:00.000Z"),
    });
  });

  it("continues repair and ignores stale watcher callbacks when stopping the old watcher fails", async () => {
    const originalPlatform = process.platform;
    const onBackgroundError = vi.fn();
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      await bootstrapMainProcess({
        runStartupIndexing: false,
        onBackgroundError,
      });
      await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
      const liveSessionStore = getLastLiveSessionStore();
      liveSessionStore.noteStructuralInvalidation.mockClear();
      liveSessionStore.handleWatcherBatch.mockClear();
      liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart.mockClear();
      liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
      liveSessionStore.hasStructuralInvalidationPending.mockReturnValue(true);
      liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(
        Date.parse("2026-04-11T08:59:00.000Z"),
      );

      const firstWatcher = mockFileWatcherInstances[0];
      if (!firstWatcher) {
        throw new Error("Expected watcher instance");
      }
      firstWatcher.stop.mockRejectedValueOnce(new Error("stop failed"));
      await firstWatcher.onFilesChanged({
        changedPaths: [],
        requiresFullScan: true,
      });

      await settleIndexingJob({
        source: "watch_fallback_incremental",
        request: { kind: "incremental" },
        startedAtMs: Date.parse("2026-04-11T09:00:00.000Z"),
        success: true,
      });

      await vi.waitFor(() => {
        expect(onBackgroundError).toHaveBeenCalledWith(
          "failed stopping old watcher during structural restart",
          expect.any(Error),
          expect.objectContaining({ backend: "kqueue" }),
        );
        expect(liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart).toHaveBeenCalledTimes(
          1,
        );
        expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
      });

      mockEnqueueChangedFiles.mockClear();
      liveSessionStore.handleWatcherBatch.mockClear();
      await firstWatcher.onFilesChanged({
        changedPaths: ["/codex/root/2026/04/11/old-watcher.jsonl"],
        requiresFullScan: false,
      });

      expect(liveSessionStore.handleWatcherBatch).not.toHaveBeenCalled();
      expect(mockEnqueueChangedFiles).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("still repairs after structural invalidation when restarting the watcher fails", async () => {
    const originalPlatform = process.platform;
    const onBackgroundError = vi.fn();
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      await bootstrapMainProcess({
        runStartupIndexing: false,
        onBackgroundError,
      });
      await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
      const liveSessionStore = getLastLiveSessionStore();
      liveSessionStore.noteStructuralInvalidation.mockClear();
      liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart.mockClear();
      liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
      liveSessionStore.hasStructuralInvalidationPending.mockReturnValue(true);
      liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(
        Date.parse("2026-04-11T08:59:00.000Z"),
      );

      const firstWatcher = mockFileWatcherInstances[0];
      if (!firstWatcher) {
        throw new Error("Expected watcher instance");
      }
      await firstWatcher.onFilesChanged({
        changedPaths: [],
        requiresFullScan: true,
      });

      mockFileWatcherService.mockImplementationOnce(
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
              throw new Error("restart failed");
            }),
            stop: vi.fn(async () => {}),
            getWatchedRoots: vi.fn(() => roots),
            getStatus: vi.fn(() => ({ running: false, processing: false, pendingPathCount: 0 })),
          };
          mockFileWatcherInstances.push(instance);
          return instance;
        },
      );

      await settleIndexingJob({
        source: "watch_fallback_incremental",
        request: { kind: "incremental" },
        startedAtMs: Date.parse("2026-04-11T09:00:00.000Z"),
        success: true,
      });

      await vi.waitFor(() => {
        expect(onBackgroundError).toHaveBeenCalledWith(
          "failed restarting watcher after structural invalidation",
          expect.any(Error),
          expect.objectContaining({ backend: "kqueue" }),
        );
        expect(
          liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart,
        ).not.toHaveBeenCalled();
        expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledWith({
          minFileMtimeMs: Date.parse("2026-04-11T08:59:00.000Z"),
        });
      });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("does not restart the default watcher backend after structural fallback indexing settles", async () => {
    const originalPlatform = process.platform;
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
      await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });

      const liveSessionStore = getLastLiveSessionStore();
      liveSessionStore.noteStructuralInvalidation.mockClear();
      liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart.mockClear();
      liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
      liveSessionStore.hasStructuralInvalidationPending.mockReturnValue(true);
      liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(
        Date.parse("2026-04-11T08:58:00.000Z"),
      );

      const activeWatcher = mockFileWatcherInstances[1];
      if (!activeWatcher) {
        throw new Error("Expected default watcher instance");
      }
      await activeWatcher.onFilesChanged({
        changedPaths: [],
        requiresFullScan: true,
      });

      await settleIndexingJob({
        source: "watch_fallback_incremental",
        request: { kind: "incremental" },
        startedAtMs: Date.parse("2026-04-11T09:00:00.000Z"),
        success: true,
      });

      await vi.waitFor(() => {
        expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
      });
      expect(mockFileWatcherInstances).toHaveLength(2);
      expect(activeWatcher.stop).not.toHaveBeenCalled();
      expect(liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("repairs live sessions after successful manual incremental refresh completion", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    const liveSessionStore = getLastLiveSessionStore();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
    liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(null);

    await settleIndexingJob({
      source: "manual_incremental",
      request: { kind: "incremental" },
      startedAtMs: Date.parse("2026-04-11T09:10:00.000Z"),
      success: true,
    });

    await vi.waitFor(() => {
      expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
    });
    expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledWith({
      minFileMtimeMs: Date.parse("2026-04-11T09:10:00.000Z"),
    });
  });

  it("temporarily starts the live store to repair manual refreshes when no watcher is active using the indexing baseline", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const liveSessionStore = getLastLiveSessionStore();
    liveSessionStore.start.mockClear();
    liveSessionStore.stop.mockClear();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
    liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(null);

    await settleIndexingJob({
      source: "manual_incremental",
      request: { kind: "incremental" },
      startedAtMs: Date.parse("2026-04-11T06:00:00.000Z"),
      success: true,
    });

    await vi.waitFor(() => {
      expect(liveSessionStore.start).toHaveBeenCalledTimes(1);
      expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
      expect(liveSessionStore.stop).toHaveBeenCalledTimes(1);
    });
    expect(liveSessionStore.start.mock.invocationCallOrder[0]).toBeLessThan(
      liveSessionStore.repairRecentSessionsAfterIndexing.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
    expect(
      liveSessionStore.repairRecentSessionsAfterIndexing.mock.invocationCallOrder[0],
    ).toBeLessThan(liveSessionStore.stop.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledWith({
      minFileMtimeMs: Date.parse("2026-04-11T06:00:00.000Z"),
    });
  });

  it("stops the temporarily started live store when repair throws", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    const liveSessionStore = getLastLiveSessionStore();
    liveSessionStore.start.mockClear();
    liveSessionStore.stop.mockClear();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockRejectedValueOnce(
      new Error("repair failed"),
    );

    await settleIndexingJob({
      source: "manual_incremental",
      request: { kind: "incremental" },
      startedAtMs: Date.parse("2026-04-11T09:20:00.000Z"),
      success: true,
    });

    await vi.waitFor(() => {
      expect(liveSessionStore.start).toHaveBeenCalledTimes(1);
      expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
      expect(liveSessionStore.stop).toHaveBeenCalledTimes(1);
    });
  });

  it("does not repair live sessions after targeted watcher indexing completes", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    const liveSessionStore = getLastLiveSessionStore();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();

    await settleIndexingJob({
      source: "watch_targeted",
      request: { kind: "changedFiles" },
      success: true,
    });

    expect(liveSessionStore.repairRecentSessionsAfterIndexing).not.toHaveBeenCalled();
  });

  it("retains pending structural invalidation until the next successful qualifying indexing completion", async () => {
    await bootstrapMainProcess({ runStartupIndexing: false });
    await getRequiredHandler(handlers, "watcher:start")({ debounceMs: 5000 });
    const liveSessionStore = getLastLiveSessionStore();
    const firstWatcher = mockFileWatcherInstances[0];
    if (!firstWatcher) {
      throw new Error("Expected watcher instance");
    }

    liveSessionStore.noteStructuralInvalidation.mockClear();
    liveSessionStore.repairRecentSessionsAfterIndexing.mockClear();
    liveSessionStore.hasStructuralInvalidationPending.mockReturnValue(true);
    liveSessionStore.getStructuralInvalidationObservedAtMs.mockReturnValue(
      Date.parse("2026-04-11T08:30:00.000Z"),
    );

    await firstWatcher.onFilesChanged({
      changedPaths: [],
      requiresFullScan: true,
    });
    expect(liveSessionStore.noteStructuralInvalidation).toHaveBeenCalledTimes(1);

    await settleIndexingJob({
      source: "watch_fallback_incremental",
      request: { kind: "incremental" },
      startedAtMs: Date.parse("2026-04-11T09:00:00.000Z"),
      success: false,
    });
    expect(liveSessionStore.repairRecentSessionsAfterIndexing).not.toHaveBeenCalled();

    await settleIndexingJob({
      source: "manual_incremental",
      request: { kind: "incremental" },
      startedAtMs: Date.parse("2026-04-11T09:10:00.000Z"),
      success: true,
    });
    await vi.waitFor(() => {
      expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledTimes(1);
    });
    expect(liveSessionStore.repairRecentSessionsAfterIndexing).toHaveBeenCalledWith({
      minFileMtimeMs: Date.parse("2026-04-11T08:30:00.000Z"),
    });
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
      listSessionsMany: vi.fn(),
      getSessionDetail: vi.fn(),
      listProjectBookmarks: vi.fn(),
      getBookmarkStates: vi.fn(),
      toggleBookmark: vi.fn(),
      runSearchQuery: vi.fn(),
      deleteProject: vi.fn(),
      deleteSession: vi.fn(),
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
