import { readdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

import { BrowserWindow, type WebContents, app, dialog, ipcMain, shell } from "electron";

import {
  CLAUDE_HOOK_EVENT_NAME_VALUES,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_DISCOVERY_CONFIG,
  type DiscoveryConfig,
  type IndexingFileIssue,
  type IndexingNotice,
  type IpcRequest,
  type IpcResponse,
  PROVIDER_LIST,
  type ProjectIndexingScope,
  type Provider,
  createProviderRecord,
  hasFileExtension,
  indexerConfigBaseSchema,
  initializeDatabase,
  isPathWithinRoot,
  listDiscoverySettingsPaths,
  listDiscoveryWatchRoots,
  paneStateBaseSchema,
  resolveEnabledProviders,
  resolveSystemMessageRegexRules,
} from "@codetrail/core";

import { HISTORY_EXPORT_PROGRESS_CHANNEL } from "../shared/historyExport";
import { LIVE_STATUS_CHANGED_CHANNEL } from "../shared/liveStatusPush";
import type { AppStateStore } from "./appStateStore";
import { initializeBookmarkStore, resolveBookmarksDbPath } from "./data/bookmarkStore";
import { type QueryService, createQueryService } from "./data/queryService";
import { listAvailableEditors, openInEditor } from "./editorRegistry";
import {
  cleanupStaleEditorTempArtifacts,
  resetActiveEditorTempArtifacts,
} from "./editorTempArtifacts";
import {
  type FileWatcherBatch,
  type FileWatcherOptions,
  FileWatcherService,
} from "./fileWatcherService";
import { exportHistoryMessages } from "./historyExport";
import type { IndexingJobSource } from "./indexingJobSource";
import { WorkerIndexingRunner } from "./indexingRunner";
import { registerIpcHandlers } from "./ipc";
import { appendLiveInstrumentationRecord, getLiveUiTraceLogPath } from "./live/liveInstrumentation";
import { LiveSessionStore } from "./liveSessionStore";
import { getCurrentMainPlatformConfig } from "./platformConfig";
import { WatchStatsStore } from "./watchStatsStore";

const MIN_ZOOM_PERCENT = 60;
const MAX_ZOOM_PERCENT = 175;
const DEFAULT_ZOOM_PERCENT = 100;
const ZOOM_STEP_PERCENT = 10;

export type BootstrapOptions = {
  dbPath?: string;
  runStartupIndexing?: boolean;
  instrumentationEnabled?: boolean;
  appStateStore?: AppStateStore;
  onCommandStateChanged?: (state: IpcRequest<"app:setCommandState">) => void;
  onIndexingFileIssue?: (issue: IndexingFileIssue) => void;
  onIndexingNotice?: (notice: IndexingNotice) => void;
  onBackgroundError?: (message: string, error: unknown, details?: Record<string, unknown>) => void;
};

export type BootstrapResult = {
  schemaVersion: number;
  tableCount: number;
};

type IndexingJobSettledEvent = {
  source: IndexingJobSource;
  request: {
    kind: "incremental" | "changedFiles" | "maintenance";
  };
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  success: boolean;
};

type MainProcessRuntimeState = {
  queryService: QueryService | null;
  fileWatcher: FileWatcherService | null;
  liveSessionStore: LiveSessionStore | null;
  watcherDebounceMs: 1000 | 3000 | 5000 | null;
  watcherBackend: "default" | "kqueue" | null;
  activeWatcherToken: symbol | null;
  watcherLeaseCounts: Map<number, number>;
  watcherTrackedSenderIds: Set<number>;
  watcherTransitionQueue: Promise<void>;
};

// The main process owns long-lived resources: databases, IPC handlers, indexing workers, and the
// path allowlist used by shell integrations.
let runtimeState: MainProcessRuntimeState | null = null;

function createRuntimeState(): MainProcessRuntimeState {
  return {
    queryService: null,
    fileWatcher: null,
    liveSessionStore: null,
    watcherDebounceMs: null,
    watcherBackend: null,
    activeWatcherToken: null,
    watcherLeaseCounts: new Map(),
    watcherTrackedSenderIds: new Set(),
    watcherTransitionQueue: Promise.resolve(),
  };
}

function createDefaultClaudeHookState(input: {
  appUserDataPath: string;
  appHomePath: string;
  lastError?: string | null;
}): IpcResponse<"watcher:getLiveStatus">["claudeHookState"] {
  return {
    settingsPath: join(input.appHomePath, ".claude", "settings.json"),
    logPath: join(input.appUserDataPath, "live-status", "claude-hooks.jsonl"),
    installed: false,
    managed: false,
    managedEventNames: [],
    missingEventNames: [...CLAUDE_HOOK_EVENT_NAME_VALUES],
    lastError: input.lastError ?? null,
  };
}

function filterPotentialLiveTranscriptPaths(
  changedPaths: string[],
  discoveryConfig: Pick<DiscoveryConfig, "claudeRoot" | "codexRoot" | "copilotCliRoot">,
): string[] {
  return changedPaths.filter((changedPath) => {
    if (!hasFileExtension(changedPath, ".jsonl")) {
      return false;
    }
    return (
      isPathWithinOptionalRoot(changedPath, discoveryConfig.claudeRoot) ||
      isPathWithinOptionalRoot(changedPath, discoveryConfig.codexRoot) ||
      isPathWithinOptionalRoot(changedPath, discoveryConfig.copilotCliRoot)
    );
  });
}

function isPathWithinOptionalRoot(
  candidatePath: string,
  rootPath: string | null | undefined,
): boolean {
  return typeof rootPath === "string" && rootPath.length > 0
    ? isPathWithinRoot(candidatePath, rootPath)
    : false;
}

function shouldRepairAfterIndexingJob(event: IndexingJobSettledEvent): boolean {
  if (!event.success || event.request.kind !== "incremental") {
    return false;
  }
  switch (event.source) {
    case "startup_incremental":
    case "manual_incremental":
    case "manual_force_reindex":
    case "manual_project_force_reindex":
    case "watch_initial_scan":
    case "watch_fallback_incremental":
      return true;
    case "watch_targeted":
      return false;
    default:
      return false;
  }
}

async function disposeRuntimeState(state: MainProcessRuntimeState | null): Promise<void> {
  if (!state) {
    return;
  }
  if (state.fileWatcher) {
    await state.fileWatcher.stop();
    state.fileWatcher = null;
  }
  if (state.liveSessionStore) {
    await state.liveSessionStore.stop();
    state.liveSessionStore = null;
  }
  state.watcherDebounceMs = null;
  state.watcherBackend = null;
  state.activeWatcherToken = null;
  state.watcherLeaseCounts.clear();
  state.watcherTrackedSenderIds.clear();
  state.watcherTransitionQueue = Promise.resolve();
  state.queryService?.close();
  state.queryService = null;
}

export async function bootstrapMainProcess(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  await disposeRuntimeState(runtimeState);
  resetActiveEditorTempArtifacts();
  await cleanupStaleEditorTempArtifacts({
    readdir,
    stat,
    rm,
  }).catch(() => undefined);
  const runtime = createRuntimeState();
  const mainPlatform = getCurrentMainPlatformConfig();
  runtimeState = runtime;
  const dbPath = options.dbPath ?? join(app.getPath("userData"), "codetrail.sqlite");
  const bookmarksDbPath = resolveBookmarksDbPath(dbPath);
  const settingsFilePath =
    options.appStateStore?.getFilePath() ?? join(app.getPath("userData"), "ui-state.json");
  const geminiHistoryRoot =
    DEFAULT_DISCOVERY_CONFIG.geminiHistoryRoot ?? join(app.getPath("home"), ".gemini", "history");
  const geminiProjectsPath =
    DEFAULT_DISCOVERY_CONFIG.geminiProjectsPath ??
    join(app.getPath("home"), ".gemini", "projects.json");
  const discoveryConfig = {
    ...DEFAULT_DISCOVERY_CONFIG,
    geminiHistoryRoot,
    geminiProjectsPath,
  };

  const dbBootstrap = initializeDatabase(dbPath);
  initializeBookmarkStore(bookmarksDbPath);
  const watchStatsStore = new WatchStatsStore();
  const getEnabledProviders = () =>
    resolveEnabledProviders(options.appStateStore?.getIndexingState()?.enabledProviders);
  const liveInstrumentationEnabled = options.instrumentationEnabled ?? false;
  const liveUiTraceLogPath = getLiveUiTraceLogPath(app.getPath("userData"));
  const getRemoveMissingSessionsDuringIncrementalIndexing = () =>
    options.appStateStore?.getIndexingState()?.removeMissingSessionsDuringIncrementalIndexing ??
    false;
  const getEffectiveDiscoveryConfig = () => ({
    ...discoveryConfig,
    enabledProviders: getEnabledProviders(),
  });
  const indexingRunner = new WorkerIndexingRunner(dbPath, {
    bookmarksDbPath,
    getEnabledProviders,
    getRemoveMissingSessionsDuringIncrementalIndexing,
    getSystemMessageRegexRules: () =>
      options.appStateStore?.getPaneState()?.systemMessageRegexRules,
    onJobSettled: (event) => {
      watchStatsStore.recordJobSettled(event);
      if (!shouldRepairAfterIndexingJob(event)) {
        return;
      }
      void queueWatcherTransition(async () => {
        await liveSessionStoreSync.catch(() => undefined);
        if (!runtime.liveSessionStore || !isLiveWatchEnabled()) {
          return;
        }
        const watcherActive = runtime.fileWatcher !== null && runtime.watcherDebounceMs !== null;
        const watcherInactive = runtime.fileWatcher === null && runtime.watcherDebounceMs === null;
        if (!watcherActive && !watcherInactive) {
          throw new Error("Inconsistent watcher state during post-index live repair.");
        }
        const temporarilyStartedForRepair = watcherInactive;
        const shouldRestartWatcherForStructuralInvalidation =
          watcherActive &&
          runtime.liveSessionStore.hasStructuralInvalidationPending() &&
          runtime.watcherBackend !== null &&
          mainPlatform.preferredWatcherBackends.some(
            (backendPlan) =>
              backendPlan.backend === runtime.watcherBackend &&
              backendPlan.restartOnStructuralInvalidation,
          );
        try {
          if (temporarilyStartedForRepair) {
            await runtime.liveSessionStore.start({
              discoveryConfig: getEffectiveDiscoveryConfig(),
            });
          }
          let restartStartedAtMs: number | null = null;
          if (shouldRestartWatcherForStructuralInvalidation) {
            try {
              restartStartedAtMs = await restartWatcherForStructuralInvalidation();
            } catch (error) {
              reportBackgroundError(
                "failed restarting watcher after structural invalidation",
                error,
                {
                  backend: runtime.watcherBackend,
                },
              );
            }
          }
          if (restartStartedAtMs !== null) {
            const catchupResult =
              await runtime.liveSessionStore.catchUpTrackedTranscriptsAfterWatcherRestart({
                restartStartedAtMs,
              });
            watchStatsStore.recordForcedWatcherRestart({
              restartAtMs: restartStartedAtMs,
              trackedCatchupCount: catchupResult.processedTrackedFileCount,
            });
          }
          const repairMinFileMtimeMs =
            runtime.liveSessionStore.getStructuralInvalidationObservedAtMs() ?? event.startedAtMs;
          const repairResult = await runtime.liveSessionStore.repairRecentSessionsAfterIndexing({
            minFileMtimeMs: repairMinFileMtimeMs,
          });
          watchStatsStore.recordPostRepairStaleCandidateCount(
            repairResult.staleCandidateCountAfterRepair,
          );
        } finally {
          if (temporarilyStartedForRepair) {
            await runtime.liveSessionStore.stop();
          }
        }
      }).catch((error: unknown) =>
        reportBackgroundError("post-index live repair failed", error, {
          source: event.source,
          requestKind: event.request.kind,
        }),
      );
    },
    ...(options.onIndexingFileIssue ? { onFileIssue: options.onIndexingFileIssue } : {}),
    ...(options.onIndexingNotice ? { onNotice: options.onIndexingNotice } : {}),
  });
  const queryService = createQueryService(dbPath, { bookmarksDbPath });
  runtime.queryService = queryService;
  runtime.liveSessionStore = new LiveSessionStore({
    queryService,
    userDataDir: app.getPath("userData"),
    homeDir: app.getPath("home"),
    instrumentationEnabled: liveInstrumentationEnabled,
    ...(options.onBackgroundError ? { onBackgroundError: options.onBackgroundError } : {}),
    onSnapshotInvalidated: () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(LIVE_STATUS_CHANGED_CHANNEL);
        }
      }
    },
  });
  await runtime.liveSessionStore.prepareClaudeHookLogForAppStart().catch((error: unknown) => {
    if (options.onBackgroundError) {
      options.onBackgroundError("Failed preparing Claude hook log", error);
      return;
    }
    console.error("[codetrail] failed preparing Claude hook log", error);
  });
  let allowedRootsCache: { roots: string[]; expiresAt: number } | null = null;
  const readAllowedRoots = (): string[] => {
    const now = Date.now();
    if (!allowedRootsCache || allowedRootsCache.expiresAt <= now) {
      allowedRootsCache = {
        roots: getAllowedOpenInFileManagerRoots({
          dbPath,
          bookmarksDbPath,
          settingsFilePath,
          queryService,
          discoveryConfig: getEffectiveDiscoveryConfig(),
        }),
        expiresAt: now + 5_000,
      };
    }
    return allowedRootsCache.roots;
  };
  const invalidateAllowedRootsCache = () => {
    allowedRootsCache = null;
  };

  const discoverySettingsPaths = listDiscoverySettingsPaths(discoveryConfig);
  const applyEnabledProviderFilter = (providers: Provider[] | undefined): Provider[] =>
    providers
      ? providers.filter((provider) => getEnabledProviders().includes(provider))
      : [...getEnabledProviders()];
  const resolveProjectScope = (projectId: string): ProjectIndexingScope | null => {
    const project = queryService.getProjectById(projectId);
    if (!project) {
      return null;
    }
    return {
      provider: project.provider,
      projectPath: project.path,
    };
  };
  const isLiveWatchEnabled = (): boolean =>
    options.appStateStore?.getPaneState()?.liveWatchEnabled ?? true;
  let liveSessionStoreSync: Promise<void> = Promise.resolve();
  const syncLiveSessionStore = async () => {
    liveSessionStoreSync = liveSessionStoreSync
      .catch((error) => {
        if (options.onBackgroundError) {
          options.onBackgroundError("live session store sync failed", error);
          return;
        }
        console.error("[codetrail] live session store sync failed", error);
      })
      .then(async () => {
        if (!runtime.liveSessionStore) {
          return;
        }
        if (!runtime.fileWatcher || runtime.watcherDebounceMs === null || !isLiveWatchEnabled()) {
          await runtime.liveSessionStore.stop();
          return;
        }
        await runtime.liveSessionStore.start({
          discoveryConfig: getEffectiveDiscoveryConfig(),
        });
      });
    return liveSessionStoreSync;
  };

  // Serialize watcher transitions in the main process so stale renderer cleanups cannot race a
  // newer start request and leave watch mode disabled.
  const queueWatcherTransition = <T>(transition: () => Promise<T>): Promise<T> => {
    const queuedTransition = runtime.watcherTransitionQueue.then(transition, transition);
    runtime.watcherTransitionQueue = queuedTransition.then(
      () => undefined,
      () => undefined,
    );
    return queuedTransition;
  };

  const hasWatcherLeases = () => runtime.watcherLeaseCounts.size > 0;

  const incrementWatcherLease = (senderId: number) => {
    runtime.watcherLeaseCounts.set(senderId, (runtime.watcherLeaseCounts.get(senderId) ?? 0) + 1);
  };

  const decrementWatcherLease = (senderId: number) => {
    const nextLeaseCount = (runtime.watcherLeaseCounts.get(senderId) ?? 0) - 1;
    if (nextLeaseCount > 0) {
      runtime.watcherLeaseCounts.set(senderId, nextLeaseCount);
      return;
    }
    runtime.watcherLeaseCounts.delete(senderId);
  };

  const stopActiveWatcher = async () => {
    if (runtime.fileWatcher) {
      await runtime.fileWatcher.stop();
      runtime.fileWatcher = null;
    }
    runtime.watcherDebounceMs = null;
    runtime.watcherBackend = null;
    runtime.activeWatcherToken = null;
    await syncLiveSessionStore();
  };

  const reportBackgroundError = (
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => {
    if (options.onBackgroundError) {
      options.onBackgroundError(message, error, details);
      return;
    }
    console.error(`[codetrail] ${message}`, error, details);
  };

  const trackWatcherSender = (sender: Pick<WebContents, "id" | "once">) => {
    if (runtime.watcherTrackedSenderIds.has(sender.id)) {
      return;
    }
    runtime.watcherTrackedSenderIds.add(sender.id);
    sender.once("destroyed", () => {
      runtime.watcherTrackedSenderIds.delete(sender.id);
      runtime.watcherLeaseCounts.delete(sender.id);
      void queueWatcherTransition(async () => {
        if (hasWatcherLeases() || !runtime.fileWatcher) {
          return;
        }
        await stopActiveWatcher();
      });
    });
  };

  // Count leases per sender instead of tracking a boolean owner. React StrictMode and remounts can
  // produce overlapping start/stop calls from the same window, and the stale stop must only
  // release one lease instead of tearing down the watcher outright.
  const acquireWatcherLease = (sender: Pick<WebContents, "id" | "once">) => {
    trackWatcherSender(sender);
    incrementWatcherLease(sender.id);
  };

  const releaseWatcherLease = (senderId: number) => {
    decrementWatcherLease(senderId);
  };

  const flushDurablePaneStateFlagsIfChanged = (
    previousPaneState: ReturnType<NonNullable<typeof options.appStateStore>["getPaneState"]>,
    nextPaneState: ReturnType<NonNullable<typeof options.appStateStore>["getPaneState"]>,
  ) => {
    if (!options.appStateStore) {
      return;
    }
    if (
      previousPaneState?.liveWatchEnabled !== nextPaneState?.liveWatchEnabled ||
      previousPaneState?.claudeHooksPrompted !== nextPaneState?.claudeHooksPrompted
    ) {
      options.appStateStore.flush();
    }
  };

  const syncLiveSessionStoreForPaneStateChange = async (
    previousLiveWatchEnabled: boolean,
    nextLiveWatchEnabled: boolean,
  ) => {
    if (previousLiveWatchEnabled === nextLiveWatchEnabled) {
      return;
    }
    await syncLiveSessionStore();
  };

  const createWatcherService = (
    watcherRoots: string[],
    debounceMs: 1000 | 3000 | 5000,
    watcherToken: symbol,
    watcherOptions: FileWatcherOptions,
  ) =>
    new FileWatcherService(
      watcherRoots,
      async (batch: FileWatcherBatch) => {
        if (runtime.activeWatcherToken !== watcherToken) {
          return;
        }
        invalidateAllowedRootsCache();
        const changedPaths = [...new Set(batch.changedPaths)];
        if (batch.requiresFullScan) {
          const structuralInvalidationObservedAtMs = Date.now();
          runtime.liveSessionStore?.noteStructuralInvalidation(structuralInvalidationObservedAtMs);
          watchStatsStore.recordStructuralInvalidation(structuralInvalidationObservedAtMs);
        }
        const liveChangedPaths = filterPotentialLiveTranscriptPaths(
          changedPaths,
          getEffectiveDiscoveryConfig(),
        );
        if (liveChangedPaths.length > 0) {
          await runtime.liveSessionStore?.handleWatcherBatch({
            ...batch,
            changedPaths: liveChangedPaths,
          });
        }
        const prefetchedJsonlChunks =
          runtime.liveSessionStore?.takeIndexingPrefetchedJsonlChunks(changedPaths) ?? [];
        watchStatsStore.recordWatcherTrigger({
          changedPathCount: changedPaths.length,
          requiresFullScan: batch.requiresFullScan,
        });
        const enqueuePromise = batch.requiresFullScan
          ? indexingRunner.enqueue({ force: false }, { source: "watch_fallback_incremental" })
          : indexingRunner.enqueueChangedFiles(changedPaths, {
              source: "watch_targeted",
              ...(prefetchedJsonlChunks.length > 0 ? { prefetchedJsonlChunks } : {}),
            });
        void enqueuePromise.catch((error: unknown) =>
          reportBackgroundError("watcher-triggered indexing failed", error, {
            requiresFullScan: batch.requiresFullScan,
            changedPathCount: changedPaths.length,
          }),
        );
      },
      {
        ...watcherOptions,
        debounceMs,
      },
    );

  const startWatcherFromPlan = async (
    debounceMs: 1000 | 3000 | 5000,
    backendPlan: (typeof mainPlatform.preferredWatcherBackends)[number],
    options: { syncLiveStore?: boolean } = {},
  ) => {
    const watcherRoots = listDiscoveryWatchRoots(getEffectiveDiscoveryConfig());
    const watcherToken = Symbol(`watcher-${backendPlan.backend}`);
    const fileWatcher = createWatcherService(
      watcherRoots,
      debounceMs,
      watcherToken,
      backendPlan.subscribeOptions ? { subscribeOptions: backendPlan.subscribeOptions } : {},
    );
    await fileWatcher.start();
    runtime.activeWatcherToken = watcherToken;
    runtime.fileWatcher = fileWatcher;
    runtime.watcherDebounceMs = debounceMs;
    runtime.watcherBackend = backendPlan.backend;
    if (options.syncLiveStore !== false) {
      await syncLiveSessionStore();
    }
    watchStatsStore.recordWatcherStart({
      backend: backendPlan.backend,
      watchedRootCount: fileWatcher.getWatchedRoots().length,
    });
    return {
      backend: backendPlan.backend,
      watchedRoots: fileWatcher.getWatchedRoots(),
    };
  };

  const startWatcherWithConfig = async (
    debounceMs: 1000 | 3000 | 5000,
    options: { preferredBackend?: "default" | "kqueue"; syncLiveStore?: boolean } = {},
  ) => {
    const backendPlans =
      options.preferredBackend !== undefined
        ? mainPlatform.preferredWatcherBackends.filter(
            (backendPlan) => backendPlan.backend === options.preferredBackend,
          )
        : mainPlatform.preferredWatcherBackends;
    if (backendPlans.length === 0) {
      throw new Error("No file watcher backend plan matched the requested backend.");
    }
    for (const backendPlan of backendPlans) {
      try {
        return await startWatcherFromPlan(
          debounceMs,
          backendPlan,
          options.syncLiveStore === undefined ? {} : { syncLiveStore: options.syncLiveStore },
        );
      } catch (error) {
        if (backendPlan.backend !== "default" && options.preferredBackend === undefined) {
          console.warn(
            backendPlan.failureMessage ??
              "[codetrail] failed to start preferred file watcher backend",
            error,
          );
        }
      }
    }
    throw new Error("No file watcher backend could be started.");
  };

  const ensureWatcherRunning = async (
    debounceMs: 1000 | 3000 | 5000,
    restartOptions: { forceRestart?: boolean } = {},
  ) => {
    if (
      !restartOptions.forceRestart &&
      runtime.fileWatcher &&
      runtime.watcherDebounceMs === debounceMs &&
      runtime.watcherBackend
    ) {
      return {
        backend: runtime.watcherBackend,
        watchedRoots: runtime.fileWatcher.getWatchedRoots(),
        didRestart: false,
      };
    }
    await stopActiveWatcher();
    const startedWatcher = await startWatcherWithConfig(debounceMs);
    return {
      ...startedWatcher,
      didRestart: true,
    };
  };

  const restartWatcherForStructuralInvalidation = async (): Promise<number> => {
    const currentWatcher = runtime.fileWatcher;
    const currentBackend = runtime.watcherBackend;
    const currentDebounceMs = runtime.watcherDebounceMs;
    if (!currentWatcher || !currentBackend || currentDebounceMs === null) {
      throw new Error("Expected an active watcher before structural restart.");
    }
    const restartStartedAtMs = Date.now();
    const restartedWatcher = await startWatcherWithConfig(currentDebounceMs, {
      preferredBackend: currentBackend,
      syncLiveStore: false,
    });
    try {
      await currentWatcher.stop({ flushPending: true });
    } catch (error) {
      reportBackgroundError("failed stopping old watcher during structural restart", error, {
        backend: currentBackend,
        watchedRoots: currentWatcher.getWatchedRoots(),
      });
    }
    return restartStartedAtMs;
  };

  registerIpcHandlers(
    ipcMain,
    {
      "app:getHealth": () => ({
        status: "ok",
        version: app.getVersion(),
      }),
      "app:flushState": () => {
        options.appStateStore?.flush();
        return { ok: true };
      },
      "app:getSettingsInfo": () => ({
        storage: {
          settingsFile: settingsFilePath,
          cacheDir: app.getPath("sessionData"),
          databaseFile: dbPath,
          bookmarksDatabaseFile: bookmarksDbPath,
          userDataDir: app.getPath("userData"),
        },
        discovery: {
          providers: PROVIDER_LIST.map((provider) => ({
            provider: provider.id,
            label: provider.label,
            paths: discoverySettingsPaths
              .filter((path) => path.provider === provider.id)
              .map((path) => ({
                key: path.key,
                label: path.label,
                value: path.value,
                watch: path.watch,
              })),
          })),
        },
      }),
      "db:getSchemaVersion": () => ({
        schemaVersion: dbBootstrap.schemaVersion,
      }),
      "app:setCommandState": (payload) => {
        options.onCommandStateChanged?.(payload);
        return { ok: true };
      },
      "indexer:refresh": async (payload) => {
        invalidateAllowedRootsCache();
        if (payload.projectId && !payload.force) {
          throw new Error("Project-scoped reindex is only supported for force reindex.");
        }
        const projectScope = payload.projectId ? resolveProjectScope(payload.projectId) : null;
        if (payload.projectId && !projectScope) {
          throw new Error("This project no longer exists in the database.");
        }
        const job = await indexingRunner.enqueue(
          {
            force: payload.force,
            ...(projectScope ? { projectScope } : {}),
          },
          {
            source: payload.projectId
              ? "manual_project_force_reindex"
              : payload.force
                ? "manual_force_reindex"
                : "manual_incremental",
          },
        );
        return { jobId: job.jobId };
      },
      "indexer:getStatus": () => indexingRunner.getStatus(),
      "projects:list": (payload) =>
        queryService.listProjects({
          ...payload,
          providers: applyEnabledProviderFilter(payload.providers),
        }),
      "projects:delete": (payload) => {
        const result = queryService.deleteProject(payload);
        invalidateAllowedRootsCache();
        return result;
      },
      "projects:getCombinedDetail": (payload) => queryService.getProjectCombinedDetail(payload),
      "sessions:list": (payload) => queryService.listSessions(payload),
      "sessions:listMany": (payload) => queryService.listSessionsMany(payload),
      "sessions:getDetail": (payload) => queryService.getSessionDetail(payload),
      "sessions:getTurn": (payload) => queryService.getSessionTurn(payload),
      "sessions:delete": (payload) => {
        const result = queryService.deleteSession(payload);
        invalidateAllowedRootsCache();
        return result;
      },
      "bookmarks:listProject": (payload) => queryService.listProjectBookmarks(payload),
      "bookmarks:getStates": (payload) => queryService.getBookmarkStates(payload),
      "bookmarks:toggle": (payload) => queryService.toggleBookmark(payload),
      "history:exportMessages": async (payload, event) =>
        exportHistoryMessages({
          browserWindow: BrowserWindow.fromWebContents(event.sender),
          onProgress: (progress) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(HISTORY_EXPORT_PROGRESS_CHANNEL, progress);
            }
          },
          queryService,
          request: payload,
        }),
      "search:query": (payload) =>
        queryService.runSearchQuery({
          ...payload,
          providers: applyEnabledProviderFilter(payload.providers),
        }),
      "path:openInFileManager": async (payload) => {
        if (!isAbsolute(payload.path)) {
          return { ok: false, error: "Path must be absolute." };
        }
        const targetPath = await resolveCanonicalPath(payload.path);
        // Only permit shell-open for indexed workspaces and app-owned storage to avoid turning IPC
        // into a generic arbitrary-path opener.
        const allowedRoots = readAllowedRoots();
        if (!isPathAllowedByRoots(targetPath, allowedRoots)) {
          return {
            ok: false,
            error: "Path is outside indexed projects and app storage roots.",
          };
        }
        try {
          const fileStat = await stat(targetPath);
          if (fileStat.isFile()) {
            shell.showItemInFolder(targetPath);
            return { ok: true, error: null };
          }
        } catch {
          // Fall through to generic shell open.
        }

        const error = await shell.openPath(targetPath);
        return {
          ok: error.length === 0,
          error: error.length > 0 ? error : null,
        };
      },
      "dialog:pickExternalToolCommand": async () => {
        const dialogResult = await dialog.showOpenDialog({
          title: "Choose External Tool Command",
          buttonLabel: "Choose Command",
          ...mainPlatform.externalToolCommandDialog,
        });
        if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
          return { canceled: true, path: null, error: null };
        }

        const selectedPath = dialogResult.filePaths[0] ?? null;
        if (!selectedPath) {
          return { canceled: true, path: null, error: null };
        }

        const validationError = await validateExternalToolCommandPath(selectedPath);
        if (validationError) {
          return { canceled: false, path: null, error: validationError };
        }

        return { canceled: false, path: selectedPath, error: null };
      },
      "editor:listAvailable": (payload) => {
        const paneState = options.appStateStore?.getPaneState() ?? null;
        return listAvailableEditors(
          payload.externalTools
            ? {
                ...(paneState ?? {}),
                externalTools: payload.externalTools,
              }
            : paneState,
        );
      },
      "editor:open": async (payload) => {
        if ("filePath" in payload && payload.filePath) {
          if (!isAbsolute(payload.filePath)) {
            return {
              ok: false,
              error: "File path must be absolute.",
            };
          }
          const targetPath = await resolveCanonicalPath(payload.filePath);
          if (!isPathAllowedByRoots(targetPath, readAllowedRoots())) {
            return {
              ok: false,
              error: "Path is outside indexed projects and app storage roots.",
            };
          }
        }
        const paneState = options.appStateStore?.getPaneState() ?? null;
        return openInEditor(payload, paneState);
      },
      "ui:getPaneState": () => {
        const paneState = options.appStateStore?.getPaneState();
        const result = Object.fromEntries(
          Object.keys(paneStateBaseSchema.shape)
            .filter((key) => key !== "systemMessageRegexRules")
            .map((key) => [key, paneState?.[key as keyof typeof paneState] ?? null]),
        );
        return {
          ...result,
          historyVisualization:
            paneState?.historyVisualization ??
            (paneState?.historyDetailMode === "turn"
              ? "turns"
              : paneState?.historyMode === "bookmarks"
                ? "bookmarks"
                : "messages"),
          // systemMessageRegexRules needs special resolution to fill in defaults for new providers.
          systemMessageRegexRules: resolveSystemMessageRegexRules(
            paneState?.systemMessageRegexRules,
          ),
        } as IpcResponse<"ui:getPaneState">;
      },
      "ui:setPaneState": (payload) => {
        const previousPaneState = options.appStateStore?.getPaneState() ?? null;
        const previousLiveWatchEnabled = isLiveWatchEnabled();
        options.appStateStore?.setPaneStateRuntimeOnly(payload);
        const nextPaneState = options.appStateStore?.getPaneState() ?? null;
        const nextLiveWatchEnabled = isLiveWatchEnabled();
        flushDurablePaneStateFlagsIfChanged(previousPaneState, nextPaneState);
        void syncLiveSessionStoreForPaneStateChange(
          previousLiveWatchEnabled,
          nextLiveWatchEnabled,
        ).catch((error: unknown) => {
          if (options.onBackgroundError) {
            options.onBackgroundError("live watch feature toggle failed", error);
            return;
          }
          console.error("[codetrail] live watch feature toggle failed", error);
        });
        return { ok: true };
      },
      "indexer:getConfig": () => {
        const indexingState = options.appStateStore?.getIndexingState();
        const result = Object.fromEntries(
          Object.keys(indexerConfigBaseSchema.shape).map((key) => [
            key,
            indexingState?.[key as keyof typeof indexingState] ?? null,
          ]),
        );
        return {
          ...result,
          enabledProviders: getEnabledProviders(),
          removeMissingSessionsDuringIncrementalIndexing:
            getRemoveMissingSessionsDuringIncrementalIndexing(),
        } as IpcResponse<"indexer:getConfig">;
      },
      "indexer:setConfig": async (payload) => {
        const previousEnabledProviders = getEnabledProviders();
        options.appStateStore?.setIndexingState(payload);
        const nextEnabledProviders = getEnabledProviders();
        const enabledProvidersChanged =
          previousEnabledProviders.length !== nextEnabledProviders.length ||
          previousEnabledProviders.some((provider) => !nextEnabledProviders.includes(provider));
        if (enabledProvidersChanged) {
          const disabledProviders = previousEnabledProviders.filter(
            (provider) => !nextEnabledProviders.includes(provider),
          );
          invalidateAllowedRootsCache();
          if (disabledProviders.length > 0) {
            try {
              await indexingRunner.purgeProviders(disabledProviders, {
                source: "manual_incremental",
              });
            } catch (error) {
              if (options.onBackgroundError) {
                options.onBackgroundError("provider disable cleanup failed", error, {
                  providers: disabledProviders,
                });
              } else {
                console.error("[codetrail] provider disable cleanup failed", error);
              }
            }
          }
          const activeWatcherDebounceMs = runtime.watcherDebounceMs;
          if (runtime.fileWatcher && activeWatcherDebounceMs !== null) {
            try {
              await queueWatcherTransition(async () =>
                ensureWatcherRunning(activeWatcherDebounceMs, {
                  forceRestart: true,
                }),
              );
            } catch {
              await stopActiveWatcher();
            }
          }
        }
        void indexingRunner
          .enqueue({ force: false }, { source: "manual_incremental" })
          .catch((error) => {
            if (options.onBackgroundError) {
              options.onBackgroundError("provider enablement refresh failed", error);
            } else {
              console.error("[codetrail] provider enablement refresh failed", error);
            }
          });
        return { ok: true };
      },
      "ui:getZoom": (_payload, event) => ({
        percent: Math.round(event.sender.getZoomFactor() * 100),
      }),
      "ui:setZoom": (payload, event) => {
        const currentPercent = Math.round(event.sender.getZoomFactor() * 100);
        let nextPercent = currentPercent;
        if ("percent" in payload) {
          nextPercent = payload.percent;
        } else if (payload.action === "reset") {
          nextPercent = DEFAULT_ZOOM_PERCENT;
        } else if (payload.action === "in") {
          nextPercent = currentPercent + ZOOM_STEP_PERCENT;
        } else {
          nextPercent = currentPercent - ZOOM_STEP_PERCENT;
        }
        const clampedPercent = Math.round(
          Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, nextPercent)),
        );
        event.sender.setZoomFactor(clampedPercent / 100);
        return {
          percent: clampedPercent,
        };
      },
      "watcher:start": async (payload, event) => {
        if (event?.sender) {
          acquireWatcherLease(event.sender);
        }
        try {
          const startedWatcher = await queueWatcherTransition(async () =>
            ensureWatcherRunning(payload.debounceMs),
          );

          if (startedWatcher.didRestart) {
            // Run one full incremental scan to bring the DB up to date before relying on events.
            void indexingRunner
              .enqueue({ force: false }, { source: "watch_initial_scan" })
              .catch((error: unknown) => {
                if (options.onBackgroundError) {
                  options.onBackgroundError("watcher initial scan failed", error);
                  return;
                }
                console.error("[codetrail] watcher initial scan failed", error);
              });
          }
          return {
            ok: true,
            watchedRoots: startedWatcher.watchedRoots,
            backend: startedWatcher.backend,
          };
        } catch {
          if (event?.sender) {
            releaseWatcherLease(event.sender.id);
          }
          return { ok: false, watchedRoots: [], backend: "default" as const };
        }
      },
      "watcher:getStatus": async () => {
        return (
          runtime.fileWatcher?.getStatus() ?? {
            running: false,
            processing: false,
            pendingPathCount: 0,
          }
        );
      },
      "watcher:getStats": async () => watchStatsStore.snapshot(),
      "watcher:stop": async (_payload, event) => {
        if (event?.sender) {
          releaseWatcherLease(event.sender.id);
          await queueWatcherTransition(async () => {
            if (hasWatcherLeases() || !runtime.fileWatcher) {
              return;
            }
            await stopActiveWatcher();
          });
        } else {
          await queueWatcherTransition(stopActiveWatcher);
        }
        return { ok: true };
      },
      "watcher:getLiveStatus": async () =>
        runtime.liveSessionStore?.snapshot() ?? {
          enabled: false,
          revision: 0,
          updatedAt: new Date().toISOString(),
          instrumentationEnabled: liveInstrumentationEnabled,
          providerCounts: createProviderRecord(() => 0),
          sessions: [],
          claudeHookState: createDefaultClaudeHookState({
            appHomePath: app.getPath("home"),
            appUserDataPath: app.getPath("userData"),
          }),
        },
      "claudeHooks:install": async () => {
        const liveSessionStore = runtime.liveSessionStore;
        return {
          ok: true as const,
          state: liveSessionStore
            ? await liveSessionStore.installClaudeHooks()
            : createDefaultClaudeHookState({
                appHomePath: app.getPath("home"),
                appUserDataPath: app.getPath("userData"),
                lastError: "Live watch is not available.",
              }),
        };
      },
      "claudeHooks:remove": async () => {
        const liveSessionStore = runtime.liveSessionStore;
        return {
          ok: true as const,
          state: liveSessionStore
            ? await liveSessionStore.removeClaudeHooks()
            : createDefaultClaudeHookState({
                appHomePath: app.getPath("home"),
                appUserDataPath: app.getPath("userData"),
                lastError: "Live watch is not available.",
              }),
        };
      },
      "debug:recordLiveUiTrace": async (payload) => {
        if (!liveInstrumentationEnabled) {
          return { ok: true as const };
        }
        appendLiveInstrumentationRecord(liveUiTraceLogPath, {
          recordedAt: new Date().toISOString(),
          kind: "ui_live_row",
          ...payload,
        });
        return { ok: true as const };
      },
    },
    {
      onValidationError: ({ channel, stage, error, payload }) => {
        if (options.onBackgroundError) {
          options.onBackgroundError(`IPC ${stage} validation failed for ${channel}`, error, {
            payload,
          });
          return;
        }
        console.error(`[codetrail] IPC ${stage} validation failed for ${channel}`, error, payload);
      },
    },
  );

  if (options.runStartupIndexing ?? true) {
    void indexingRunner
      .enqueue({ force: false }, { source: "startup_incremental" })
      .catch((error: unknown) => {
        if (options.onBackgroundError) {
          options.onBackgroundError("startup incremental indexing failed", error);
          return;
        }
        console.error("[codetrail] startup incremental indexing failed", error);
      });
  }

  return {
    schemaVersion: dbBootstrap.schemaVersion ?? DATABASE_SCHEMA_VERSION,
    tableCount: dbBootstrap.tables.length,
  };
}

export async function shutdownMainProcess(): Promise<void> {
  await disposeRuntimeState(runtimeState);
  runtimeState = null;
  resetActiveEditorTempArtifacts();
}

function getAllowedOpenInFileManagerRoots(input: {
  dbPath: string;
  bookmarksDbPath: string;
  settingsFilePath: string;
  queryService: QueryService;
  discoveryConfig: typeof DEFAULT_DISCOVERY_CONFIG & { enabledProviders?: Provider[] };
}): string[] {
  const roots = new Set<string>();
  const addRoot = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    roots.add(normalizeResolvedPath(trimmed));
  };

  addRoot(input.dbPath);
  addRoot(input.bookmarksDbPath);
  addRoot(input.settingsFilePath);
  addRoot(app.getPath("userData"));
  addRoot(app.getPath("sessionData"));
  for (const path of listDiscoverySettingsPaths(input.discoveryConfig)) {
    addRoot(path.value);
    if (path.key === "geminiProjectsPath") {
      addRoot(dirname(path.value));
    }
  }

  try {
    // Indexed project paths are dynamic, so fold them into the static provider/app roots cache.
    const projects = input.queryService.listProjects({
      providers: input.discoveryConfig.enabledProviders,
      query: "",
    });
    for (const project of projects.projects) {
      addRoot(project.path);
    }
  } catch {
    // Keep static roots if project lookup fails.
  }

  return [...roots];
}

function normalizeResolvedPath(value: string): string {
  return resolve(normalize(value));
}

async function resolveCanonicalPath(value: string): Promise<string> {
  const normalizedPath = normalizeResolvedPath(value);
  try {
    return normalizeResolvedPath(await realpath(normalizedPath));
  } catch {
    return normalizedPath;
  }
}

async function validateExternalToolCommandPath(value: string): Promise<string | null> {
  const mainPlatform = getCurrentMainPlatformConfig();
  const resolvedPath = await resolveCanonicalPath(value);

  try {
    const entry = await stat(resolvedPath);
    if (entry.isFile()) {
      return null;
    }
    if (
      mainPlatform.externalToolCommandValidation.allowAppBundle &&
      resolvedPath.toLowerCase().endsWith(".app")
    ) {
      return null;
    }
    return mainPlatform.externalToolCommandValidation.invalidSelectionMessage;
  } catch {
    return "Selected command could not be accessed.";
  }
}

function isPathAllowedByRoots(targetPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => isPathWithinRoot(targetPath, root));
}
