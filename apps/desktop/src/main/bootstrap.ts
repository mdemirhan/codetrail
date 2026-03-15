import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import { app, ipcMain, shell } from "electron";

import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_DISCOVERY_CONFIG,
  type IndexingFileIssue,
  type IndexingNotice,
  type IpcResponse,
  initializeDatabase,
  paneStateBaseSchema,
  resolveSystemMessageRegexRules,
} from "@codetrail/core";

import type { AppStateStore } from "./appStateStore";
import { initializeBookmarkStore, resolveBookmarksDbPath } from "./data/bookmarkStore";
import { type QueryService, createQueryService } from "./data/queryService";
import { type FileWatcherOptions, FileWatcherService } from "./fileWatcherService";
import { WorkerIndexingRunner } from "./indexingRunner";
import { registerIpcHandlers } from "./ipc";

const MIN_ZOOM_PERCENT = 60;
const MAX_ZOOM_PERCENT = 175;
const DEFAULT_ZOOM_PERCENT = 100;
const ZOOM_STEP_PERCENT = 10;

export type BootstrapOptions = {
  dbPath?: string;
  runStartupIndexing?: boolean;
  appStateStore?: AppStateStore;
  onIndexingFileIssue?: (issue: IndexingFileIssue) => void;
  onIndexingNotice?: (notice: IndexingNotice) => void;
  onBackgroundError?: (message: string, error: unknown, details?: Record<string, unknown>) => void;
};

export type BootstrapResult = {
  schemaVersion: number;
  tableCount: number;
};

// The main process owns long-lived resources: databases, IPC handlers, indexing workers, and the
// path allowlist used by shell integrations.
let activeQueryService: QueryService | null = null;
let activeFileWatcher: FileWatcherService | null = null;

export async function bootstrapMainProcess(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const dbPath = options.dbPath ?? join(app.getPath("userData"), "codetrail.sqlite");
  const bookmarksDbPath = resolveBookmarksDbPath(dbPath);
  const settingsFilePath =
    options.appStateStore?.getFilePath() ?? join(app.getPath("userData"), "ui-state.json");
  const geminiHistoryRoot =
    DEFAULT_DISCOVERY_CONFIG.geminiHistoryRoot ?? join(app.getPath("home"), ".gemini", "history");
  const geminiProjectsPath =
    DEFAULT_DISCOVERY_CONFIG.geminiProjectsPath ??
    join(app.getPath("home"), ".gemini", "projects.json");

  const dbBootstrap = initializeDatabase(dbPath);
  initializeBookmarkStore(bookmarksDbPath);
  const indexingRunner = new WorkerIndexingRunner(dbPath, {
    bookmarksDbPath,
    getSystemMessageRegexRules: () =>
      options.appStateStore?.getPaneState()?.systemMessageRegexRules,
    ...(options.onIndexingFileIssue ? { onFileIssue: options.onIndexingFileIssue } : {}),
    ...(options.onIndexingNotice ? { onNotice: options.onIndexingNotice } : {}),
  });
  if (activeQueryService) {
    activeQueryService.close();
  }
  const queryService = createQueryService(dbPath, { bookmarksDbPath });
  activeQueryService = queryService;
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
          geminiHistoryRoot,
          geminiProjectsPath,
        }),
        expiresAt: now + 5_000,
      };
    }
    return allowedRootsCache.roots;
  };
  const invalidateAllowedRootsCache = () => {
    allowedRootsCache = null;
  };

  const watcherRoots = [
    DEFAULT_DISCOVERY_CONFIG.claudeRoot,
    DEFAULT_DISCOVERY_CONFIG.codexRoot,
    DEFAULT_DISCOVERY_CONFIG.geminiRoot,
    geminiHistoryRoot,
    DEFAULT_DISCOVERY_CONFIG.cursorRoot,
  ];
  registerIpcHandlers(ipcMain, {
    "app:getHealth": () => ({
      status: "ok",
      version: app.getVersion(),
    }),
    "app:getSettingsInfo": () => ({
      storage: {
        settingsFile: settingsFilePath,
        cacheDir: app.getPath("sessionData"),
        databaseFile: dbPath,
        bookmarksDatabaseFile: bookmarksDbPath,
        userDataDir: app.getPath("userData"),
      },
      discovery: {
        claudeRoot: DEFAULT_DISCOVERY_CONFIG.claudeRoot,
        codexRoot: DEFAULT_DISCOVERY_CONFIG.codexRoot,
        geminiRoot: DEFAULT_DISCOVERY_CONFIG.geminiRoot,
        geminiHistoryRoot,
        geminiProjectsPath,
        cursorRoot: DEFAULT_DISCOVERY_CONFIG.cursorRoot,
      },
    }),
    "db:getSchemaVersion": () => ({
      schemaVersion: dbBootstrap.schemaVersion,
    }),
    "indexer:refresh": async (payload) => {
      invalidateAllowedRootsCache();
      const job = await indexingRunner.enqueue({ force: payload.force });
      return { jobId: job.jobId };
    },
    "indexer:getStatus": () => indexingRunner.getStatus(),
    "projects:list": (payload) => queryService.listProjects(payload),
    "projects:getCombinedDetail": (payload) => queryService.getProjectCombinedDetail(payload),
    "sessions:list": (payload) => queryService.listSessions(payload),
    "sessions:getDetail": (payload) => queryService.getSessionDetail(payload),
    "bookmarks:listProject": (payload) => queryService.listProjectBookmarks(payload),
    "bookmarks:toggle": (payload) => queryService.toggleBookmark(payload),
    "search:query": (payload) => queryService.runSearchQuery(payload),
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
    "ui:getState": () => {
      const paneState = options.appStateStore?.getPaneState();
      const result = Object.fromEntries(
        Object.keys(paneStateBaseSchema.shape).map((key) => [
          key,
          paneState?.[key as keyof typeof paneState] ?? null,
        ]),
      );
      // systemMessageRegexRules needs special resolution to fill in defaults for new providers.
      result.systemMessageRegexRules = resolveSystemMessageRegexRules(
        paneState?.systemMessageRegexRules,
      );
      return result as IpcResponse<"ui:getState">;
    },
    "ui:setState": (payload) => {
      options.appStateStore?.setPaneState(payload);
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
    "watcher:start": async (payload) => {
      if (activeFileWatcher) {
        await activeFileWatcher.stop();
        activeFileWatcher = null;
      }

      const createFileWatcher = (watcherOptions: FileWatcherOptions) =>
        new FileWatcherService(
          watcherRoots,
          async (changedPaths) => {
            invalidateAllowedRootsCache();
            await indexingRunner.enqueueChangedFiles(changedPaths).catch((error: unknown) => {
              if (options.onBackgroundError) {
                options.onBackgroundError("watcher-triggered indexing failed", error);
                return;
              }
              console.error("[codetrail] watcher-triggered indexing failed", error);
            });
          },
          watcherOptions,
        );

      const startWatcher = async (
        watcherOptions: FileWatcherOptions,
        backend: "default" | "kqueue",
      ) => {
        const fileWatcher = createFileWatcher({
          ...watcherOptions,
          debounceMs: payload.debounceMs,
        });
        await fileWatcher.start();
        activeFileWatcher = fileWatcher;
        return {
          backend,
          watchedRoots: fileWatcher.getWatchedRoots(),
        };
      };

      try {
        let startedWatcher: {
          backend: "default" | "kqueue";
          watchedRoots: string[];
        };

        if (process.platform === "darwin") {
          try {
            // Codex transcript appends on this macOS setup were missed by both Parcel's default
            // FSEvents backend and a direct CoreServices FSEvents probe, while Parcel's kqueue
            // backend consistently observed them. We force kqueue here for correctness and keep
            // the default backend only as a fallback if kqueue subscription setup fails.
            startedWatcher = await startWatcher(
              { subscribeOptions: { backend: "kqueue" } },
              "kqueue",
            );
          } catch (error) {
            console.warn(
              "[codetrail] Failed to start kqueue watcher on macOS, falling back to default backend",
              error,
            );
            startedWatcher = await startWatcher({}, "default");
          }
        } else {
          startedWatcher = await startWatcher({}, "default");
        }

        // Run one full incremental scan to bring the DB up to date before relying on events
        void indexingRunner.enqueue({ force: false }).catch((error: unknown) => {
          if (options.onBackgroundError) {
            options.onBackgroundError("watcher initial scan failed", error);
            return;
          }
          console.error("[codetrail] watcher initial scan failed", error);
        });
        return {
          ok: true,
          watchedRoots: startedWatcher.watchedRoots,
          backend: startedWatcher.backend,
        };
      } catch {
        return { ok: false, watchedRoots: [], backend: "default" as const };
      }
    },
    "watcher:getStatus": async () => {
      return (
        activeFileWatcher?.getStatus() ?? { running: false, processing: false, pendingPathCount: 0 }
      );
    },
    "watcher:stop": async () => {
      if (activeFileWatcher) {
        await activeFileWatcher.stop();
        activeFileWatcher = null;
      }
      return { ok: true };
    },
  });

  if (options.runStartupIndexing ?? true) {
    void indexingRunner.enqueue({ force: false }).catch((error: unknown) => {
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
  if (activeFileWatcher) {
    await activeFileWatcher.stop();
    activeFileWatcher = null;
  }
  if (!activeQueryService) {
    return;
  }
  activeQueryService.close();
  activeQueryService = null;
}

function getAllowedOpenInFileManagerRoots(input: {
  dbPath: string;
  bookmarksDbPath: string;
  settingsFilePath: string;
  queryService: QueryService;
  geminiHistoryRoot: string;
  geminiProjectsPath: string;
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
  addRoot(DEFAULT_DISCOVERY_CONFIG.claudeRoot);
  addRoot(DEFAULT_DISCOVERY_CONFIG.codexRoot);
  addRoot(DEFAULT_DISCOVERY_CONFIG.geminiRoot);
  addRoot(input.geminiHistoryRoot);
  addRoot(input.geminiProjectsPath);
  addRoot(dirname(input.geminiProjectsPath));
  addRoot(DEFAULT_DISCOVERY_CONFIG.cursorRoot);

  try {
    // Indexed project paths are dynamic, so fold them into the static provider/app roots cache.
    const projects = input.queryService.listProjects({ providers: undefined, query: "" });
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

function isPathAllowedByRoots(targetPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => isPathWithinRoot(targetPath, root));
}

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
