import { stat } from "node:fs/promises";
import { join } from "node:path";

import { app, ipcMain, shell } from "electron";

import { DATABASE_SCHEMA_VERSION, initializeDatabase } from "@cch/core";

import { getSessionDetail, listProjects, listSessions, runSearchQuery } from "./data/queryService";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { WorkerIndexingRunner } from "./worker/indexingRunner";

export type BootstrapOptions = {
  dbPath?: string;
};

export type BootstrapResult = {
  schemaVersion: number;
  tableCount: number;
};

export async function bootstrapMainProcess(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const dbPath = options.dbPath ?? join(app.getPath("userData"), "cch-ts.sqlite");

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
  });

  return {
    schemaVersion: dbBootstrap.schemaVersion ?? DATABASE_SCHEMA_VERSION,
    tableCount: dbBootstrap.tables.length,
  };
}
