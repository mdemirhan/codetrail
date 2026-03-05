import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import { app, ipcMain, shell } from "electron";

import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_DISCOVERY_CONFIG,
  initializeDatabase,
  resolveSystemMessageRegexRules,
} from "@codetrail/core";

import type { AppStateStore } from "./appStateStore";
import { initializeBookmarkStore, resolveBookmarksDbPath } from "./data/bookmarkStore";
import { type QueryService, createQueryService } from "./data/queryService";
import { WorkerIndexingRunner } from "./indexingRunner";
import { registerIpcHandlers } from "./ipc";

export type BootstrapOptions = {
  dbPath?: string;
  runStartupIndexing?: boolean;
  appStateStore?: AppStateStore;
};

export type BootstrapResult = {
  schemaVersion: number;
  tableCount: number;
};

let activeQueryService: QueryService | null = null;

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
      return {
        projectPaneWidth: paneState?.projectPaneWidth ?? null,
        sessionPaneWidth: paneState?.sessionPaneWidth ?? null,
        projectPaneCollapsed: paneState?.projectPaneCollapsed ?? null,
        sessionPaneCollapsed: paneState?.sessionPaneCollapsed ?? null,
        projectProviders: paneState?.projectProviders ?? null,
        historyCategories: paneState?.historyCategories ?? null,
        expandedByDefaultCategories: paneState?.expandedByDefaultCategories ?? null,
        searchProviders: paneState?.searchProviders ?? null,
        theme: paneState?.theme ?? null,
        monoFontFamily: paneState?.monoFontFamily ?? null,
        regularFontFamily: paneState?.regularFontFamily ?? null,
        monoFontSize: paneState?.monoFontSize ?? null,
        regularFontSize: paneState?.regularFontSize ?? null,
        useMonospaceForAllMessages: paneState?.useMonospaceForAllMessages ?? null,
        selectedProjectId: paneState?.selectedProjectId ?? null,
        selectedSessionId: paneState?.selectedSessionId ?? null,
        historyMode: paneState?.historyMode ?? null,
        projectSortDirection: paneState?.projectSortDirection ?? null,
        sessionSortDirection: paneState?.sessionSortDirection ?? null,
        messageSortDirection: paneState?.messageSortDirection ?? null,
        bookmarkSortDirection: paneState?.bookmarkSortDirection ?? null,
        projectAllSortDirection: paneState?.projectAllSortDirection ?? null,
        sessionPage: paneState?.sessionPage ?? null,
        sessionScrollTop: paneState?.sessionScrollTop ?? null,
        systemMessageRegexRules: resolveSystemMessageRegexRules(paneState?.systemMessageRegexRules),
      };
    },
    "ui:setState": (payload) => {
      options.appStateStore?.setPaneState({
        projectPaneWidth: payload.projectPaneWidth,
        sessionPaneWidth: payload.sessionPaneWidth,
        projectPaneCollapsed: payload.projectPaneCollapsed,
        sessionPaneCollapsed: payload.sessionPaneCollapsed,
        projectProviders: payload.projectProviders,
        historyCategories: payload.historyCategories,
        expandedByDefaultCategories: payload.expandedByDefaultCategories,
        searchProviders: payload.searchProviders,
        theme: payload.theme,
        monoFontFamily: payload.monoFontFamily,
        regularFontFamily: payload.regularFontFamily,
        monoFontSize: payload.monoFontSize,
        regularFontSize: payload.regularFontSize,
        useMonospaceForAllMessages: payload.useMonospaceForAllMessages,
        selectedProjectId: payload.selectedProjectId,
        selectedSessionId: payload.selectedSessionId,
        historyMode: payload.historyMode,
        projectSortDirection: payload.projectSortDirection,
        sessionSortDirection: payload.sessionSortDirection,
        messageSortDirection: payload.messageSortDirection,
        bookmarkSortDirection: payload.bookmarkSortDirection,
        projectAllSortDirection: payload.projectAllSortDirection,
        sessionPage: payload.sessionPage,
        sessionScrollTop: payload.sessionScrollTop,
        systemMessageRegexRules: payload.systemMessageRegexRules,
      });
      return { ok: true };
    },
    "ui:getZoom": (_payload, event) => ({
      percent: Math.round(event.sender.getZoomFactor() * 100),
    }),
    "ui:setZoom": (payload, event) => {
      const zoomStep = 0.5;
      const current = event.sender.getZoomLevel();
      if (payload.action === "reset") {
        event.sender.setZoomLevel(0);
      } else if (payload.action === "in") {
        event.sender.setZoomLevel(current + zoomStep);
      } else {
        event.sender.setZoomLevel(current - zoomStep);
      }
      return {
        percent: Math.round(event.sender.getZoomFactor() * 100),
      };
    },
  });

  if (options.runStartupIndexing ?? true) {
    void indexingRunner.enqueue({ force: false }).catch((error: unknown) => {
      console.error("[codetrail] startup incremental indexing failed", error);
    });
  }

  return {
    schemaVersion: dbBootstrap.schemaVersion ?? DATABASE_SCHEMA_VERSION,
    tableCount: dbBootstrap.tables.length,
  };
}

export function shutdownMainProcess(): void {
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
