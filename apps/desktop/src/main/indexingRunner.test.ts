import { describe, expect, it, vi } from "vitest";

import { WorkerIndexingRunner, shouldUseIndexingWorker } from "./indexingRunner";

type WorkerMessage =
  | { type: "result"; ok: true }
  | { type: "result"; ok: false; message: string; stack?: string }
  | {
      type: "file-issue";
      issue: {
        provider: "claude" | "codex" | "gemini" | "cursor";
        sessionId: string;
        filePath: string;
        stage: "read" | "parse" | "persist";
        error: unknown;
      };
    }
  | {
      type: "notice";
      notice: {
        provider: "claude" | "codex" | "gemini" | "cursor";
        sessionId: string;
        filePath: string;
        stage: "read" | "parse" | "persist";
        severity: "info" | "warning";
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };
type WorkerRequest = {
  kind?: string;
  dbPath: string;
  forceReindex?: boolean;
  changedFilePaths?: string[];
  systemMessageRegexRules?: {
    claude?: string[];
    codex?: string[];
    gemini?: string[];
    cursor?: string[];
  };
};

type WorkerController = {
  worker: {
    on(event: "message", listener: (value: WorkerMessage) => void): void;
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
    message: Array<(value: WorkerMessage) => void>;
    error?: (error: unknown) => void;
    exit?: (code: number) => void;
  } = {
    message: [],
  };
  let lastRequest: WorkerRequest | null = null;

  return {
    worker: {
      on(event, listener) {
        if (event === "message") {
          listeners.message.push(listener as (value: WorkerMessage) => void);
          return;
        }
        throw new Error(`Unsupported event registration: ${event}`);
      },
      once(event, listener) {
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
    emitMessage: (value) => {
      for (const listener of listeners.message) {
        listener(value);
      }
    },
    emitError: (error) => listeners.error?.(error),
    emitExit: (code) => listeners.exit?.(code),
  };
}

async function withIndexingWorkerOverride<T>(
  value: "0" | "1" | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = process.env.CODETRAIL_ENABLE_INDEXING_WORKER;
  if (value === undefined) {
    process.env.CODETRAIL_ENABLE_INDEXING_WORKER = undefined;
  } else {
    process.env.CODETRAIL_ENABLE_INDEXING_WORKER = value;
  }
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      process.env.CODETRAIL_ENABLE_INDEXING_WORKER = undefined;
    } else {
      process.env.CODETRAIL_ENABLE_INDEXING_WORKER = previous;
    }
  }
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
    countProjectBookmarks: vi.fn(() => 0),
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
  it("disables the bundled worker on Electron 35+ for macOS by default", () => {
    expect(
      shouldUseIndexingWorker({
        platform: "darwin",
        electronVersion: "35.0.0",
      }),
    ).toBe(false);
  });

  it("allows overriding the worker runtime decision explicitly", () => {
    expect(
      shouldUseIndexingWorker({
        platform: "darwin",
        electronVersion: "35.0.0",
        enableWorkerOverride: "1",
      }),
    ).toBe(true);
    expect(
      shouldUseIndexingWorker({
        platform: "linux",
        electronVersion: "34.3.0",
        enableWorkerOverride: "0",
      }),
    ).toBe(false);
  });

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
    expect(runIncrementalIndexing).toHaveBeenCalledWith(
      { dbPath: "/tmp/codetrail.db", forceReindex: true },
      {},
    );
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

    expect(runIncrementalIndexing).toHaveBeenCalledWith(
      {
        dbPath: "/tmp/codetrail.db",
        forceReindex: false,
        systemMessageRegexRules: {
          claude: ["^<command-name>"],
          codex: ["^<environment_context>"],
          gemini: [],
          cursor: [],
        },
      },
      {},
    );
    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
  });

  it("uses worker path when worker returns success", async () => {
    await withIndexingWorkerOverride("1", async () => {
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
      expect(runner.getStatus()).toEqual({
        running: true,
        queuedJobs: 1,
        activeJobId: "refresh-1",
        completedJobs: 0,
      });
      expect(controller.getLastRequest()).toEqual({
        kind: "incremental",
        dbPath: "/tmp/codetrail.db",
        forceReindex: false,
      });

      controller.emitMessage({ type: "result", ok: true });

      await expect(job).resolves.toEqual({ jobId: "refresh-1" });
      expect(runner.getStatus()).toEqual({
        running: false,
        queuedJobs: 0,
        activeJobId: null,
        completedJobs: 1,
      });
      expect(runIncrementalIndexing).not.toHaveBeenCalled();
      expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
    });
  });

  it("falls back to direct indexing when worker returns error payload", async () => {
    await withIndexingWorkerOverride("1", async () => {
      const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
      const controller = createWorkerController();
      const bookmarkHarness = createBookmarkStoreHarness();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
          runIncrementalIndexing,
          resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
          createWorker: () => controller.worker,
          createBookmarkStore: bookmarkHarness.createBookmarkStore,
        });

        const job = runner.enqueue({ force: false });
        await Promise.resolve();
        controller.emitMessage({ type: "result", ok: false, message: "worker failed" });

        await expect(job).resolves.toEqual({ jobId: "refresh-1" });
        expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[codetrail] indexing worker failed; falling back to in-process indexing",
          expect.any(Error),
        );
        expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  it("uses child-process path when worker threads are disabled", async () => {
    await withIndexingWorkerOverride("0", async () => {
      const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
      const controller = createWorkerController();
      const bookmarkHarness = createBookmarkStoreHarness();
      const onFileIssue = vi.fn();

      const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
        runIncrementalIndexing,
        resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
        createBackgroundProcess: () => controller.worker,
        createBookmarkStore: bookmarkHarness.createBookmarkStore,
        onFileIssue,
      });

      const job = runner.enqueue({ force: false });
      await Promise.resolve();
      expect(controller.getLastRequest()).toEqual({
        kind: "incremental",
        dbPath: "/tmp/codetrail.db",
        forceReindex: false,
      });

      controller.emitMessage({
        type: "file-issue",
        issue: {
          provider: "codex",
          sessionId: "session-1",
          filePath: "/tmp/bad.jsonl",
          stage: "parse",
          error: { message: "bad line" },
        },
      });
      controller.emitMessage({ type: "result", ok: true });

      await expect(job).resolves.toEqual({ jobId: "refresh-1" });
      expect(onFileIssue).toHaveBeenCalledWith({
        provider: "codex",
        sessionId: "session-1",
        filePath: "/tmp/bad.jsonl",
        stage: "parse",
        error: { message: "bad line" },
      });
      expect(runIncrementalIndexing).not.toHaveBeenCalled();
      expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
    });
  });

  it("forwards indexing notices from the background runtime", async () => {
    await withIndexingWorkerOverride("0", async () => {
      const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
      const controller = createWorkerController();
      const bookmarkHarness = createBookmarkStoreHarness();
      const onNotice = vi.fn();

      const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
        runIncrementalIndexing,
        resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
        createBackgroundProcess: () => controller.worker,
        createBookmarkStore: bookmarkHarness.createBookmarkStore,
        onNotice,
      });

      const job = runner.enqueue({ force: false });
      await Promise.resolve();

      controller.emitMessage({
        type: "notice",
        notice: {
          provider: "codex",
          sessionId: "session-1",
          filePath: "/tmp/bad.jsonl",
          stage: "parse",
          severity: "warning",
          code: "parser.invalid_jsonl_line",
          message: "line skipped",
          details: { lineNumber: 10 },
        },
      });
      controller.emitMessage({ type: "result", ok: true });

      await expect(job).resolves.toEqual({ jobId: "refresh-1" });
      expect(onNotice).toHaveBeenCalledWith({
        provider: "codex",
        sessionId: "session-1",
        filePath: "/tmp/bad.jsonl",
        stage: "parse",
        severity: "warning",
        code: "parser.invalid_jsonl_line",
        message: "line skipped",
        details: { lineNumber: 10 },
      });
    });
  });

  it("falls back to direct indexing when background runtime exits non-zero", async () => {
    await withIndexingWorkerOverride("0", async () => {
      const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
      const controller = createWorkerController();
      const bookmarkHarness = createBookmarkStoreHarness();

      const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
        runIncrementalIndexing,
        resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
        createBackgroundProcess: () => controller.worker,
        createBookmarkStore: bookmarkHarness.createBookmarkStore,
      });

      const job = runner.enqueue({ force: true });
      await Promise.resolve();
      controller.emitExit(1);

      await expect(job).resolves.toEqual({ jobId: "refresh-1" });
      expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
      expect(runIncrementalIndexing).toHaveBeenCalledWith(
        { dbPath: "/tmp/codetrail.db", forceReindex: true },
        {},
      );
      expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
    });
  });

  it("serializes queued jobs and increments job ids", async () => {
    await withIndexingWorkerOverride("1", async () => {
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
      expect(runner.getStatus()).toEqual({
        running: true,
        queuedJobs: 2,
        activeJobId: "refresh-1",
        completedJobs: 0,
      });
      expect(workers[0]?.getLastRequest()).toEqual({
        kind: "incremental",
        dbPath: "/tmp/codetrail.db",
        forceReindex: false,
      });

      workers[0]?.emitMessage({ type: "result", ok: true });
      await expect(first).resolves.toEqual({ jobId: "refresh-1" });

      await Promise.resolve();
      expect(workers).toHaveLength(2);
      expect(runner.getStatus()).toEqual({
        running: true,
        queuedJobs: 1,
        activeJobId: "refresh-2",
        completedJobs: 1,
      });
      expect(workers[1]?.getLastRequest()).toEqual({
        kind: "incremental",
        dbPath: "/tmp/codetrail.db",
        forceReindex: true,
      });

      workers[1]?.emitMessage({ type: "result", ok: true });
      await expect(second).resolves.toEqual({ jobId: "refresh-2" });
      expect(runner.getStatus()).toEqual({
        running: false,
        queuedJobs: 0,
        activeJobId: null,
        completedJobs: 2,
      });
      expect(runIncrementalIndexing).not.toHaveBeenCalled();
      expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledTimes(2);
    });
  });

  it("enqueueChangedFiles runs targeted indexing in-process when worker is unavailable", async () => {
    const indexChangedFiles = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      indexChangedFiles,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
      bookmarksDbPath: "/tmp/codetrail.bookmarks.sqlite",
    });

    const result = await runner.enqueueChangedFiles([
      "/tmp/session-1.jsonl",
      "/tmp/session-2.jsonl",
    ]);

    expect(result).toEqual({ jobId: "changed-1" });
    expect(indexChangedFiles).toHaveBeenCalledTimes(1);
    expect(indexChangedFiles).toHaveBeenCalledWith(
      { dbPath: "/tmp/codetrail.db" },
      ["/tmp/session-1.jsonl", "/tmp/session-2.jsonl"],
      {},
    );
  });

  it("enqueueChangedFiles with empty paths returns noop without running indexing", async () => {
    const indexChangedFiles = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      indexChangedFiles,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    const result = await runner.enqueueChangedFiles([]);

    expect(result.jobId).toMatch(/^changed-\d+-noop$/);
    expect(indexChangedFiles).not.toHaveBeenCalled();
    expect(bookmarkHarness.reconcileWithIndexedData).not.toHaveBeenCalled();
  });

  it("enqueueChangedFiles reconciles bookmarks after indexing", async () => {
    const indexChangedFiles = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      indexChangedFiles,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
      bookmarksDbPath: "/tmp/codetrail.bookmarks.sqlite",
    });

    await runner.enqueueChangedFiles(["/tmp/session-1.jsonl"]);

    expect(bookmarkHarness.reconcileWithIndexedData).toHaveBeenCalledWith("/tmp/codetrail.db");
    expect(bookmarkHarness.close).toHaveBeenCalledTimes(1);
  });

  it("enqueueChangedFiles increments completedJobs counter", async () => {
    const indexChangedFiles = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      indexChangedFiles,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    expect(runner.getStatus().completedJobs).toBe(0);
    await runner.enqueueChangedFiles(["/tmp/session-1.jsonl"]);
    expect(runner.getStatus().completedJobs).toBe(1);
    await runner.enqueueChangedFiles(["/tmp/session-2.jsonl"]);
    expect(runner.getStatus().completedJobs).toBe(2);
  });

  it("enqueueChangedFiles serializes with enqueue jobs", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const indexChangedFiles = vi.fn(() => makeIndexingResult());
    const bookmarkHarness = createBookmarkStoreHarness();
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      indexChangedFiles,
      resolveWorkerUrl: () => null,
      createBookmarkStore: bookmarkHarness.createBookmarkStore,
    });

    const first = runner.enqueue({ force: false });
    const second = runner.enqueueChangedFiles(["/tmp/session-1.jsonl"]);

    await first;
    await second;

    expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
    expect(indexChangedFiles).toHaveBeenCalledTimes(1);
    expect(runner.getStatus()).toEqual({
      running: false,
      queuedJobs: 0,
      activeJobId: null,
      completedJobs: 2,
    });
  });
});
