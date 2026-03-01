import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { type SystemMessageRegexRuleOverrides, runIncrementalIndexing } from "@codetrail/core";
import {
  type BookmarkStore,
  createBookmarkStore,
  resolveBookmarksDbPath,
} from "./data/bookmarkStore";

export type RefreshJobRequest = {
  force: boolean;
};

export type RefreshJobResponse = {
  jobId: string;
};

type IndexingWorkerRequest = {
  dbPath: string;
  forceReindex: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
};

type IndexingWorkerResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

type WorkerLike = {
  once(event: "message", listener: (value: IndexingWorkerResponse) => void): void;
  once(event: "error", listener: (error: unknown) => void): void;
  once(event: "exit", listener: (code: number) => void): void;
  postMessage: (value: IndexingWorkerRequest) => void;
  terminate: () => undefined | Promise<number>;
};

export type IndexingRunnerDependencies = {
  runIncrementalIndexing?: typeof runIncrementalIndexing;
  resolveWorkerUrl?: () => URL | null;
  createWorker?: (workerUrl: URL) => WorkerLike;
  getSystemMessageRegexRules?: () => SystemMessageRegexRuleOverrides | undefined;
  bookmarksDbPath?: string;
  createBookmarkStore?: (bookmarksDbPath: string) => BookmarkStore;
};

export class WorkerIndexingRunner {
  private sequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly dbPath: string;
  private readonly workerUrl: URL | null;
  private readonly runIncrementalIndexingFn: typeof runIncrementalIndexing;
  private readonly createWorkerFn: (workerUrl: URL) => WorkerLike;
  private readonly getSystemMessageRegexRulesFn:
    | (() => SystemMessageRegexRuleOverrides | undefined)
    | null;
  private readonly bookmarksDbPath: string;
  private readonly createBookmarkStoreFn: (bookmarksDbPath: string) => BookmarkStore;

  constructor(dbPath: string, dependencies: IndexingRunnerDependencies = {}) {
    this.dbPath = dbPath;
    this.workerUrl = (dependencies.resolveWorkerUrl ?? resolveIndexingWorkerUrl)();
    this.runIncrementalIndexingFn = dependencies.runIncrementalIndexing ?? runIncrementalIndexing;
    this.createWorkerFn =
      dependencies.createWorker ??
      ((workerUrl) => {
        return new Worker(workerUrl);
      });
    this.getSystemMessageRegexRulesFn = dependencies.getSystemMessageRegexRules ?? null;
    this.bookmarksDbPath = dependencies.bookmarksDbPath ?? resolveBookmarksDbPath(dbPath);
    this.createBookmarkStoreFn = dependencies.createBookmarkStore ?? createBookmarkStore;
  }

  async enqueue(request: RefreshJobRequest): Promise<RefreshJobResponse> {
    const jobId = `refresh-${++this.sequence}`;
    const systemMessageRegexRules = this.getSystemMessageRegexRulesFn?.();
    const task = this.queue.then(async () => {
      await runIndexingJob({
        dbPath: this.dbPath,
        forceReindex: request.force,
        ...(systemMessageRegexRules ? { systemMessageRegexRules } : {}),
        workerUrl: this.workerUrl,
        runIncrementalIndexing: this.runIncrementalIndexingFn,
        createWorker: this.createWorkerFn,
      });
      const bookmarkStore = this.createBookmarkStoreFn(this.bookmarksDbPath);
      try {
        bookmarkStore.reconcileWithIndexedData(this.dbPath);
      } finally {
        bookmarkStore.close();
      }
    });

    this.queue = task.catch(() => undefined);
    await task;

    return { jobId };
  }
}

async function runIndexingJob(args: {
  dbPath: string;
  forceReindex: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
  workerUrl: URL | null;
  runIncrementalIndexing: typeof runIncrementalIndexing;
  createWorker: (workerUrl: URL) => WorkerLike;
}): Promise<void> {
  if (!args.workerUrl) {
    args.runIncrementalIndexing({
      dbPath: args.dbPath,
      forceReindex: args.forceReindex,
      ...(args.systemMessageRegexRules
        ? { systemMessageRegexRules: args.systemMessageRegexRules }
        : {}),
    });
    return;
  }

  try {
    await runIndexingInWorker(
      args.workerUrl,
      {
        dbPath: args.dbPath,
        forceReindex: args.forceReindex,
        ...(args.systemMessageRegexRules
          ? { systemMessageRegexRules: args.systemMessageRegexRules }
          : {}),
      },
      args.createWorker,
    );
  } catch {
    args.runIncrementalIndexing({
      dbPath: args.dbPath,
      forceReindex: args.forceReindex,
      ...(args.systemMessageRegexRules
        ? { systemMessageRegexRules: args.systemMessageRegexRules }
        : {}),
    });
  }
}

function runIndexingInWorker(
  workerUrl: URL,
  request: IndexingWorkerRequest,
  createWorker: (workerUrl: URL) => WorkerLike,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = createWorker(workerUrl);
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      void worker.terminate();
      callback();
    };

    worker.once("message", (response: IndexingWorkerResponse) => {
      if (!response || response.ok !== true) {
        finish(() =>
          reject(new Error(response?.message ?? "Worker returned an invalid indexing response.")),
        );
        return;
      }
      finish(resolve);
    });

    worker.once("error", (error) => {
      finish(() => reject(error));
    });

    worker.once("exit", (code) => {
      if (settled || code === 0) {
        return;
      }
      finish(() => reject(new Error(`Indexing worker exited with code ${code}.`)));
    });

    worker.postMessage(request);
  });
}

function resolveIndexingWorkerUrl(): URL | null {
  const candidates = [new URL("./indexingWorker.js", import.meta.url)];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }
  return null;
}
