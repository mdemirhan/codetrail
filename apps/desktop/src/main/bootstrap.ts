import { stat } from "node:fs/promises";
import { join } from "node:path";

import { app, ipcMain, shell } from "electron";

import { DATABASE_SCHEMA_VERSION, initializeDatabase } from "@codetrail/core";

import type { AppStateStore } from "./appStateStore";
import { getSessionDetail, listProjects, listSessions, runSearchQuery } from "./data/queryService";
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

export async function bootstrapMainProcess(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const dbPath = options.dbPath ?? join(app.getPath("userData"), "codetrail.sqlite");

  const dbBootstrap = initializeDatabase(dbPath);
  const indexingRunner = new WorkerIndexingRunner(dbPath);

  registerIpcHandlers(ipcMain, {
    "app:getHealth": () => ({
      status: "ok",
      version: app.getVersion(),
    }),
    "db:getSchemaVersion": () => ({
      schemaVersion: dbBootstrap.schemaVersion,
    }),
    "indexer:refresh": async (payload) => {
      const job = await indexingRunner.enqueue({ force: payload.force });
      return { jobId: job.jobId };
    },
    "projects:list": (payload) => listProjects(dbPath, payload),
    "sessions:list": (payload) => listSessions(dbPath, payload),
    "sessions:getDetail": (payload) => getSessionDetail(dbPath, payload),
    "search:query": (payload) => runSearchQuery(dbPath, payload),
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
        searchProviders: paneState?.searchProviders ?? null,
        searchCategories: paneState?.searchCategories ?? null,
      };
    },
    "ui:setState": (payload) => {
      options.appStateStore?.setPaneState({
        projectPaneWidth: payload.projectPaneWidth,
        sessionPaneWidth: payload.sessionPaneWidth,
        projectProviders: payload.projectProviders,
        historyCategories: payload.historyCategories,
        searchProviders: payload.searchProviders,
        searchCategories: payload.searchCategories,
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
