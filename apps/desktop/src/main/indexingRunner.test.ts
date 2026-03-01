import { describe, expect, it, vi } from "vitest";

import { WorkerIndexingRunner } from "./indexingRunner";

type WorkerMessage = { ok: true } | { ok: false; message: string };
type WorkerRequest = {
  dbPath: string;
  forceReindex: boolean;
  systemMessageRegexRules?: {
    claude?: string[];
    codex?: string[];
    gemini?: string[];
    cursor?: string[];
  };
};

type WorkerController = {
  worker: {
    once(event: "message", listener: (value: WorkerMessage) => void): void;
    once(event: "error", listener: (error: unknown) => void): void;
    once(event: "exit", listener: (code: number) => void): void;
    postMessage(value: WorkerRequest): void;
    terminate(): undefined | Promise<number>;
  };
  getLastRequest: () => WorkerRequest | null;
  emitMessage: (value: WorkerMessage) => void;
  emitError: (error: unknown) => void;
  emitExit: (code: number) => void;
};

function createWorkerController(): WorkerController {
  const listeners: {
    message?: (value: WorkerMessage) => void;
    error?: (error: unknown) => void;
    exit?: (code: number) => void;
  } = {};
  let lastRequest: WorkerRequest | null = null;

  return {
    worker: {
      once(event, listener) {
        if (event === "message") {
          listeners.message = listener as (value: WorkerMessage) => void;
          return;
        }
        if (event === "error") {
          listeners.error = listener as (error: unknown) => void;
          return;
        }
        listeners.exit = listener as (code: number) => void;
      },
      postMessage(value) {
        lastRequest = value;
      },
      terminate() {
        return undefined;
      },
    },
    getLastRequest: () => lastRequest,
    emitMessage: (value) => listeners.message?.(value),
    emitError: (error) => listeners.error?.(error),
    emitExit: (code) => listeners.exit?.(code),
  };
}

function makeIndexingResult() {
  return {
    discoveredFiles: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    removedFiles: 0,
    schemaRebuilt: false,
    diagnostics: {
      warnings: 0,
      errors: 0,
    },
  };
}

function createBookmarkStoreHarness() {
  const reconcileWithIndexedData = vi.fn(() => ({
    deletedMissingProjects: 0,
    markedOrphaned: 0,
    restored: 0,
  }));
  const close = vi.fn();
  const createBookmarkStore = vi.fn(() => ({
    listProjectBookmarks: vi.fn(),
    getBookmark: vi.fn(() => null),
    upsertBookmark: vi.fn(),
    removeBookmark: vi.fn(() => false),
    reconcileWithIndexedData,
    close,
  }));

  return {
    createBookmarkStore,
    reconcileWithIndexedData,
    close,
  };
}

describe("WorkerIndexingRunner", () => {
  it("runs indexing directly when worker is unavailable", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
      bookmarksDbPath: "/tmp/codetrail.bookmarks.sqlite",
    });

    const result = await runner.enqueue({ force: true });

    expect(result).toEqual({ jobId: "refresh-1" });
    expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
    expect(runIncrementalIndexing).toHaveBeenCalledWith({
      dbPath: "/tmp/codetrail.db",
      forceReindex: true,
    });
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
    expect(bookmarkHarness.close).toHaveBeenCalledTimes(1);
  });

  it("passes configured system message regex rules into indexing jobs", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
      getSystemMessageRegexRules: () => ({
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
      }),
    });

    await runner.enqueue({ force: false });

    expect(runIncrementalIndexing).toHaveBeenCalledWith({
      dbPath: "/tmp/codetrail.db",
      forceReindex: false,
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
      },
    });
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
  });

  it("uses worker path when worker returns success", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const controller = createWorkerController();
    const bookmarkHarness = createBookmarkStoreHarness();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => controller.worker,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    const job = runner.enqueue({ force: false });
    await Promise.resolve();
    expect(controller.getLastRequest()).toEqual({
      dbPath: "/tmp/codetrail.db",
      forceReindex: false,
    });

    controller.emitMessage({ ok: true });

    await expect(job).resolves.toEqual({ jobId: "refresh-1" });
    expect(runIncrementalIndexing).not.toHaveBeenCalled();
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
  });

  it("falls back to direct indexing when worker returns error payload", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const controller = createWorkerController();
    const bookmarkHarness = createBookmarkStoreHarness();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => controller.worker,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    const job = runner.enqueue({ force: false });
    await Promise.resolve();
    controller.emitMessage({ ok: false, message: "worker failed" });

    await expect(job).resolves.toEqual({ jobId: "refresh-1" });
    expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
  });

  it("falls back to direct indexing when worker exits non-zero", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const controller = createWorkerController();
    const bookmarkHarness = createBookmarkStoreHarness();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => controller.worker,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    const job = runner.enqueue({ force: true });
    await Promise.resolve();
    controller.emitExit(1);

    await expect(job).resolves.toEqual({ jobId: "refresh-1" });
    expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
    expect(runIncrementalIndexing).toHaveBeenCalledWith({
      dbPath: "/tmp/codetrail.db",
      forceReindex: true,
    });
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
  });

  it("serializes queued jobs and increments job ids", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const workers: WorkerController[] = [];
    const bookmarkHarness = createBookmarkStoreHarness();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => {
        const controller = createWorkerController();
        workers.push(controller);
        return controller.worker;
      },
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    const first = runner.enqueue({ force: false });
    const second = runner.enqueue({ force: true });
    await Promise.resolve();

    expect(workers).toHaveLength(1);
    expect(workers[0]?.getLastRequest()).toEqual({
      dbPath: "/tmp/codetrail.db",
      forceReindex: false,
    });

    workers[0]?.emitMessage({ ok: true });
    await expect(first).resolves.toEqual({ jobId: "refresh-1" });

    await Promise.resolve();
    expect(workers).toHaveLength(2);
    expect(workers[1]?.getLastRequest()).toEqual({
      dbPath: "/tmp/codetrail.db",
      forceReindex: true,
    });

    workers[1]?.emitMessage({ ok: true });
    await expect(second).resolves.toEqual({ jobId: "refresh-2" });
    expect(runIncrementalIndexing).not.toHaveBeenCalled();
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledTimes(2);
  });
});
