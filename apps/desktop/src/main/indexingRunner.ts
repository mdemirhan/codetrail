import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import {
  type IndexingDependencies,
  type IndexingFileIssue,
  type IndexingNotice,
  type SystemMessageRegexRuleOverrides,
  indexChangedFiles,
  runIncrementalIndexing,
} from "@codetrail/core";
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

export type IndexingStatus = {
  running: boolean;
  queuedJobs: number;
  activeJobId: string | null;
  completedJobs: number;
};

type IndexingWorkerRequest =
  | {
      kind: "incremental";
      dbPath: string;
      forceReindex: boolean;
      systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
    }
  | {
      kind: "changedFiles";
      dbPath: string;
      changedFilePaths: string[];
      systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
    };

type IndexingWorkerMessage =
  | {
      type: "result";
      ok: true;
    }
  | {
      type: "result";
      ok: false;
      message: string;
      stack?: string;
    }
  | {
      type: "file-issue";
      issue: IndexingFileIssue;
    }
  | {
      type: "notice";
      notice: IndexingNotice;
    };

type WorkerLike = {
  on(event: "message", listener: (value: IndexingWorkerMessage) => void): void;
  once(event: "error", listener: (error: unknown) => void): void;
  once(event: "exit", listener: (code: number) => void): void;
  postMessage: (value: IndexingWorkerRequest) => void;
  terminate: () => undefined | Promise<number>;
};

export type IndexingRunnerDependencies = {
  runIncrementalIndexing?: typeof runIncrementalIndexing;
  indexChangedFiles?: typeof indexChangedFiles;
  resolveWorkerUrl?: () => URL | null;
  createWorker?: (workerUrl: URL) => WorkerLike;
  createBackgroundProcess?: (workerUrl: URL) => WorkerLike;
  getSystemMessageRegexRules?: () => SystemMessageRegexRuleOverrides | undefined;
  bookmarksDbPath?: string;
  createBookmarkStore?: (bookmarksDbPath: string) => BookmarkStore;
  onFileIssue?: (issue: IndexingFileIssue) => void;
  onNotice?: (notice: IndexingNotice) => void;
};

type IndexingWorkerRuntimeOptions = {
  platform?: NodeJS.Platform;
  electronVersion?: string | undefined;
  enableWorkerOverride?: string | undefined;
};

// The runner serializes refresh requests so indexing, bookmark reconciliation, and worker fallback
// behave like one logical pipeline from the rest of the app's perspective.
export class WorkerIndexingRunner {
  private sequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly dbPath: string;
  private readonly workerUrl: URL | null;
  private readonly runIncrementalIndexingFn: typeof runIncrementalIndexing;
  private readonly indexChangedFilesFn: typeof indexChangedFiles;
  private readonly createWorkerFn: (workerUrl: URL) => WorkerLike;
  private readonly createBackgroundProcessFn: (workerUrl: URL) => WorkerLike;
  private readonly getSystemMessageRegexRulesFn:
    | (() => SystemMessageRegexRuleOverrides | undefined)
    | null;
  private readonly bookmarksDbPath: string;
  private readonly createBookmarkStoreFn: (bookmarksDbPath: string) => BookmarkStore;
  private readonly onFileIssue: ((issue: IndexingFileIssue) => void) | undefined;
  private readonly onNotice: ((notice: IndexingNotice) => void) | undefined;
  private pendingJobs = 0;
  private completedJobs = 0;
  private activeJobId: string | null = null;

  constructor(dbPath: string, dependencies: IndexingRunnerDependencies = {}) {
    this.dbPath = dbPath;
    this.workerUrl = (dependencies.resolveWorkerUrl ?? resolveIndexingWorkerUrl)();
    this.runIncrementalIndexingFn = dependencies.runIncrementalIndexing ?? runIncrementalIndexing;
    this.indexChangedFilesFn = dependencies.indexChangedFiles ?? indexChangedFiles;
    this.createWorkerFn =
      dependencies.createWorker ??
      ((workerUrl) => {
        return new Worker(workerUrl);
      });
    this.createBackgroundProcessFn =
      dependencies.createBackgroundProcess ??
      ((workerUrl) => {
        const child = spawn(process.execPath, [fileURLToPath(workerUrl)], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
          },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        if (!child.send) {
          throw new Error("Indexing child process does not support IPC.");
        }
        return {
          on(event, listener) {
            child.on(event, listener as (value: IndexingWorkerMessage) => void);
          },
          once(event, listener) {
            if (event === "exit") {
              child.once("exit", (code) => listener(code ?? 0));
              return;
            }
            child.once(event, listener as (value: unknown) => void);
          },
          postMessage(value) {
            child.send(value);
          },
          terminate() {
            child.kill();
            return undefined;
          },
        };
      });
    this.getSystemMessageRegexRulesFn = dependencies.getSystemMessageRegexRules ?? null;
    this.bookmarksDbPath = dependencies.bookmarksDbPath ?? resolveBookmarksDbPath(dbPath);
    this.createBookmarkStoreFn = dependencies.createBookmarkStore ?? createBookmarkStore;
    this.onFileIssue = dependencies.onFileIssue;
    this.onNotice = dependencies.onNotice;
  }

  async enqueue(request: RefreshJobRequest): Promise<RefreshJobResponse> {
    const systemMessageRegexRules = this.getSystemMessageRegexRulesFn?.();
    return this.enqueueJob(`refresh-${++this.sequence}`, {
      kind: "incremental",
      dbPath: this.dbPath,
      forceReindex: request.force,
      ...(systemMessageRegexRules ? { systemMessageRegexRules } : {}),
    });
  }

  async enqueueChangedFiles(changedFilePaths: string[]): Promise<RefreshJobResponse> {
    if (changedFilePaths.length === 0) {
      return { jobId: `changed-${++this.sequence}-noop` };
    }
    const systemMessageRegexRules = this.getSystemMessageRegexRulesFn?.();
    return this.enqueueJob(`changed-${++this.sequence}`, {
      kind: "changedFiles",
      dbPath: this.dbPath,
      changedFilePaths,
      ...(systemMessageRegexRules ? { systemMessageRegexRules } : {}),
    });
  }

  private async enqueueJob(
    jobId: string,
    request: IndexingWorkerRequest,
  ): Promise<RefreshJobResponse> {
    this.pendingJobs += 1;
    const task = this.queue.then(async () => {
      try {
        this.activeJobId = jobId;
        await runIndexingJob({
          request,
          workerUrl: this.workerUrl,
          runIncrementalIndexing: this.runIncrementalIndexingFn,
          indexChangedFiles: this.indexChangedFilesFn,
          createWorker: this.createWorkerFn,
          createBackgroundProcess: this.createBackgroundProcessFn,
          ...(this.onFileIssue ? { onFileIssue: this.onFileIssue } : {}),
          ...(this.onNotice ? { onNotice: this.onNotice } : {}),
        });
        const bookmarkStore = this.createBookmarkStoreFn(this.bookmarksDbPath);
        try {
          bookmarkStore.reconcileWithIndexedData(this.dbPath);
        } finally {
          bookmarkStore.close();
        }
      } finally {
        this.activeJobId = null;
        this.pendingJobs -= 1;
        this.completedJobs += 1;
      }
    });

    this.queue = task.catch(() => undefined);
    await task;

    return { jobId };
  }

  getStatus(): IndexingStatus {
    return {
      running: this.pendingJobs > 0,
      queuedJobs: this.pendingJobs,
      activeJobId: this.activeJobId,
      completedJobs: this.completedJobs,
    };
  }
}

function extractIndexingConfig(request: IndexingWorkerRequest) {
  const base = {
    dbPath: request.dbPath,
    ...(request.systemMessageRegexRules
      ? { systemMessageRegexRules: request.systemMessageRegexRules }
      : {}),
  };
  if (request.kind === "changedFiles") {
    return { kind: "changedFiles" as const, ...base, changedFilePaths: request.changedFilePaths };
  }
  return { kind: "incremental" as const, ...base, forceReindex: request.forceReindex };
}

function runInProcess(
  request: IndexingWorkerRequest,
  fns: {
    runIncrementalIndexing?: typeof runIncrementalIndexing | undefined;
    indexChangedFiles?: typeof indexChangedFiles | undefined;
  },
  deps: IndexingDependencies,
): void {
  const config = extractIndexingConfig(request);
  if (config.kind === "changedFiles") {
    fns.indexChangedFiles?.(
      {
        dbPath: config.dbPath,
        ...(config.systemMessageRegexRules
          ? { systemMessageRegexRules: config.systemMessageRegexRules }
          : {}),
      },
      config.changedFilePaths,
      deps,
    );
  } else {
    fns.runIncrementalIndexing?.(
      {
        dbPath: config.dbPath,
        forceReindex: config.forceReindex,
        ...(config.systemMessageRegexRules
          ? { systemMessageRegexRules: config.systemMessageRegexRules }
          : {}),
      },
      deps,
    );
  }
}

async function runIndexingJob(args: {
  request: IndexingWorkerRequest;
  workerUrl: URL | null;
  runIncrementalIndexing?: typeof runIncrementalIndexing;
  indexChangedFiles?: typeof indexChangedFiles;
  createWorker: (workerUrl: URL) => WorkerLike;
  createBackgroundProcess: (workerUrl: URL) => WorkerLike;
  onFileIssue?: (issue: IndexingFileIssue) => void;
  onNotice?: (notice: IndexingNotice) => void;
}): Promise<void> {
  const deps: IndexingDependencies = {
    ...(args.onFileIssue ? { onFileIssue: args.onFileIssue } : {}),
    ...(args.onNotice ? { onNotice: args.onNotice } : {}),
  };

  if (!args.workerUrl) {
    // Tests and some dev builds do not emit the worker bundle, so keep an in-process path.
    runInProcess(
      args.request,
      {
        runIncrementalIndexing: args.runIncrementalIndexing,
        indexChangedFiles: args.indexChangedFiles,
      },
      deps,
    );
    return;
  }

  try {
    const runtime = shouldUseIndexingWorker()
      ? args.createWorker(args.workerUrl)
      : args.createBackgroundProcess(args.workerUrl);
    await runIndexingInBackgroundRuntime(runtime, args.request, args.onFileIssue, args.onNotice);
  } catch (error) {
    // Falling back preserves functionality even if the worker cannot boot due to packaging or ABI
    // issues. The cost is UI responsiveness, not correctness.
    console.error("[codetrail] indexing worker failed; falling back to in-process indexing", error);
    runInProcess(
      args.request,
      {
        runIncrementalIndexing: args.runIncrementalIndexing,
        indexChangedFiles: args.indexChangedFiles,
      },
      deps,
    );
  }
}

function runIndexingInBackgroundRuntime(
  worker: WorkerLike,
  request: IndexingWorkerRequest,
  onFileIssue?: (issue: IndexingFileIssue) => void,
  onNotice?: (notice: IndexingNotice) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    // Centralize shutdown so all exit paths terminate the worker exactly once.
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      void worker.terminate();
      callback();
    };

    worker.on("message", (response: IndexingWorkerMessage) => {
      if (response?.type === "file-issue") {
        onFileIssue?.(response.issue);
        return;
      }
      if (response?.type === "notice") {
        onNotice?.(response.notice);
        return;
      }
      if (!response || response.type !== "result" || response.ok !== true) {
        const error = new Error(
          response?.type === "result"
            ? response.message
            : "Worker returned an invalid indexing response.",
        );
        if (response?.type === "result" && response.stack) {
          error.stack = response.stack;
        }
        finish(() => reject(error));
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
  const workerUrl = new URL("./indexingWorker.js", import.meta.url);
  return existsSync(fileURLToPath(workerUrl)) ? workerUrl : null;
}

export function shouldUseIndexingWorker(options: IndexingWorkerRuntimeOptions = {}): boolean {
  const enableWorkerOverride =
    options.enableWorkerOverride ?? process.env.CODETRAIL_ENABLE_INDEXING_WORKER;
  if (enableWorkerOverride === "1") {
    return true;
  }
  if (enableWorkerOverride === "0") {
    return false;
  }

  const platform = options.platform ?? process.platform;
  const electronVersion = options.electronVersion ?? process.versions.electron;
  if (!electronVersion) {
    return true;
  }

  const majorVersion = Number.parseInt(electronVersion.split(".")[0] ?? "", 10);
  if (!Number.isFinite(majorVersion)) {
    return true;
  }

  // Electron 35 on macOS can SIGTRAP while booting this bundled worker. Falling back to
  // in-process indexing preserves startup correctness at the cost of some responsiveness.
  return !(platform === "darwin" && majorVersion >= 35);
}
