import { describe, expect, it, vi } from "vitest";

import { WorkerIndexingRunner } from "./indexingRunner";

type WorkerMessage = { ok: true } | { ok: false; message: string };
type WorkerRequest = { dbPath: string; forceReindex: boolean };

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

describe("WorkerIndexingRunner", () => {
  it("runs indexing directly when worker is unavailable", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => null,
    });

    const result = await runner.enqueue({ force: true });

    expect(result).toEqual({ jobId: "refresh-1" });
    expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
    expect(runIncrementalIndexing).toHaveBeenCalledWith({
      dbPath: "/tmp/codetrail.db",
      forceReindex: true,
    });
  });

  it("passes configured system message regex rules into indexing jobs", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => null,
      getSystemMessageRegexRules: () => ({
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
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
      },
    });
  });

  it("uses worker path when worker returns success", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const controller = createWorkerController();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => controller.worker,
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
  });

  it("falls back to direct indexing when worker returns error payload", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const controller = createWorkerController();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => controller.worker,
    });

    const job = runner.enqueue({ force: false });
    await Promise.resolve();
    controller.emitMessage({ ok: false, message: "worker failed" });

    await expect(job).resolves.toEqual({ jobId: "refresh-1" });
    expect(runIncrementalIndexing).toHaveBeenCalledTimes(1);
  });

  it("falls back to direct indexing when worker exits non-zero", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const controller = createWorkerController();

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => controller.worker,
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
  });

  it("serializes queued jobs and increments job ids", async () => {
    const runIncrementalIndexing = vi.fn(() => makeIndexingResult());
    const workers: WorkerController[] = [];

    const runner = new WorkerIndexingRunner("/tmp/codetrail.db", {
      runIncrementalIndexing,
      resolveWorkerUrl: () => new URL("file:///tmp/indexingWorker.js"),
      createWorker: () => {
        const controller = createWorkerController();
        workers.push(controller);
        return controller.worker;
      },
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
  });
});
