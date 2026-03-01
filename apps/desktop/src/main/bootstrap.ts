import { stat } from "node:fs/promises";
import { join } from "node:path";

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

  registerIpcHandlers(ipcMain, {
    "app:getHealth": () => ({
      status: "ok",
      version: app.getVersion(),
    }),
    "app:getSettingsInfo": () => ({
      storage: {
        settingsFile:
          options.appStateStore?.getFilePath() ?? join(app.getPath("userData"), "ui-state.json"),
        cacheDir: app.getPath("sessionData"),
        databaseFile: dbPath,
        userDataDir: app.getPath("userData"),
      },
      discovery: {
        claudeRoot: DEFAULT_DISCOVERY_CONFIG.claudeRoot,
        codexRoot: DEFAULT_DISCOVERY_CONFIG.codexRoot,
        geminiRoot: DEFAULT_DISCOVERY_CONFIG.geminiRoot,
        geminiHistoryRoot:
          DEFAULT_DISCOVERY_CONFIG.geminiHistoryRoot ??
          join(app.getPath("home"), ".gemini", "history"),
        geminiProjectsPath:
          DEFAULT_DISCOVERY_CONFIG.geminiProjectsPath ??
          join(app.getPath("home"), ".gemini", "projects.json"),
      },
    }),
    "db:getSchemaVersion": () => ({
      schemaVersion: dbBootstrap.schemaVersion,
    }),
    "indexer:refresh": async (payload) => {
      const job = await indexingRunner.enqueue({ force: payload.force });
      return { jobId: job.jobId };
    },
    "projects:list": (payload) => queryService.listProjects(payload),
    "sessions:list": (payload) => queryService.listSessions(payload),
    "sessions:getDetail": (payload) => queryService.getSessionDetail(payload),
    "bookmarks:listProject": (payload) => queryService.listProjectBookmarks(payload),
    "bookmarks:toggle": (payload) => queryService.toggleBookmark(payload),
    "search:query": (payload) => queryService.runSearchQuery(payload),
    "path:openInFileManager": async (payload) => {
      try {
        const fileStat = await stat(payload.path);
        if (fileStat.isFile()) {
          shell.showItemInFolder(payload.path);
          return { ok: true, error: null };
        }
      } catch {
        // Fall through to generic shell open.
      }

      const error = await shell.openPath(payload.path);
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
        sessionPage: paneState?.sessionPage ?? null,
        sessionScrollTop: paneState?.sessionScrollTop ?? null,
        systemMessageRegexRules: resolveSystemMessageRegexRules(paneState?.systemMessageRegexRules),
      };
    },
    "ui:setState": (payload) => {
      options.appStateStore?.setPaneState({
        projectPaneWidth: payload.projectPaneWidth,
        sessionPaneWidth: payload.sessionPaneWidth,
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
