import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileWatcherBatch, FileWatcherOptions } from "./fileWatcherService";
import { FileWatcherService } from "./fileWatcherService";

type SubscribeFn = NonNullable<FileWatcherOptions["subscribe"]>;
type MockSubscription = { unsubscribe: ReturnType<typeof vi.fn> };
type EventCallback = Parameters<SubscribeFn>[1];

function createMockSubscribe() {
  const subscriptions: MockSubscription[] = [];
  const callbacks: EventCallback[] = [];

  const subscribe = vi.fn(async (_root: string, callback: EventCallback) => {
    const sub: MockSubscription = { unsubscribe: vi.fn(async () => {}) };
    subscriptions.push(sub);
    callbacks.push(callback);
    return sub;
  }) as unknown as SubscribeFn;

  return { subscribe, subscriptions, callbacks };
}

function expectDefined<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
}

function getSubscription(subscriptions: MockSubscription[], index: number): MockSubscription {
  return expectDefined(subscriptions[index], `Expected subscription ${index}`);
}

function getCallback(callbacks: EventCallback[], index: number): EventCallback {
  return expectDefined(callbacks[index], `Expected callback ${index}`);
}

function getBatch(onFilesChanged: ReturnType<typeof vi.fn>, index = 0): FileWatcherBatch {
  const call = expectDefined(onFilesChanged.mock.calls[index], `Expected callback call ${index}`);
  return call[0] as FileWatcherBatch;
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

const { existsSync } = await import("node:fs");
const mockExistsSync = vi.mocked(existsSync);

describe("FileWatcherService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("subscribes to all existing roots on start", async () => {
    const { subscribe } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a", "/root/b"], onFilesChanged, { subscribe });
    await service.start();

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledWith("/root/a", expect.any(Function), {});
    expect(subscribe).toHaveBeenCalledWith("/root/b", expect.any(Function), {});
    expect(service.getWatchedRoots()).toEqual(["/root/a", "/root/b"]);
    expect(service.isRunning()).toBe(true);
  });

  it("skips roots that do not exist", async () => {
    mockExistsSync.mockImplementation((path) => path !== "/root/missing");

    const { subscribe } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/exists", "/root/missing"], onFilesChanged, {
      subscribe,
    });
    await service.start();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith("/root/exists", expect.any(Function), {});
  });

  it("unsubscribes all subscriptions on stop", async () => {
    const { subscribe, subscriptions } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a", "/root/b"], onFilesChanged, { subscribe });
    await service.start();
    await service.stop();

    expect(getSubscription(subscriptions, 0).unsubscribe).toHaveBeenCalledTimes(1);
    expect(getSubscription(subscriptions, 1).unsubscribe).toHaveBeenCalledTimes(1);
    expect(service.isRunning()).toBe(false);
  });

  it("accumulates paths and passes them to callback after debounce", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 50,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [{ path: "/root/a/file1.json", type: "update" as const }]);
    getCallback(callbacks, 0)(null, [{ path: "/root/a/file2.jsonl", type: "create" as const }]);

    expect(onFilesChanged).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    const { changedPaths: paths, requiresFullScan } = getBatch(onFilesChanged);
    expect(paths).toContain("/root/a/file1.json");
    expect(paths).toContain("/root/a/file2.jsonl");
    expect(requiresFullScan).toBe(false);
  });

  it("deduplicates paths within a debounce window", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 50,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [{ path: "/root/a/same.jsonl", type: "update" as const }]);
    getCallback(callbacks, 0)(null, [{ path: "/root/a/same.jsonl", type: "update" as const }]);
    getCallback(callbacks, 0)(null, [{ path: "/root/a/same.jsonl", type: "update" as const }]);

    await vi.advanceTimersByTimeAsync(50);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    expect(getBatch(onFilesChanged)).toEqual({
      changedPaths: ["/root/a/same.jsonl"],
      requiresFullScan: false,
    });
  });

  it("does not reset timer on new events — flushes at fixed interval from first event", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 50,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [{ path: "/root/a/file.json", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(40);
    expect(onFilesChanged).not.toHaveBeenCalled();

    // New event arrives but does NOT reset the timer
    getCallback(callbacks, 0)(null, [{ path: "/root/a/other.json", type: "update" as const }]);

    // Original timer fires at t=50 (10ms from now), including both paths
    await vi.advanceTimersByTimeAsync(10);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    const { changedPaths: paths, requiresFullScan } = getBatch(onFilesChanged);
    expect(paths).toContain("/root/a/file.json");
    expect(paths).toContain("/root/a/other.json");
    expect(requiresFullScan).toBe(false);
  });

  it("starts a new timer after flush completes for events that arrive during continuous activity", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 50,
    });
    await service.start();

    // First batch
    getCallback(callbacks, 0)(null, [{ path: "/root/a/batch1.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    // Second batch — new timer starts
    getCallback(callbacks, 0)(null, [{ path: "/root/a/batch2.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(onFilesChanged).toHaveBeenCalledTimes(2);
    expect(onFilesChanged).toHaveBeenLastCalledWith({
      changedPaths: ["/root/a/batch2.jsonl"],
      requiresFullScan: false,
    });
  });

  it("only accumulates .json and .jsonl files", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 50,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [
      { path: "/root/a/file.txt", type: "update" as const },
      { path: "/root/a/file.ts", type: "update" as const },
      { path: "/root/a/file.log", type: "update" as const },
    ]);

    await vi.advanceTimersByTimeAsync(100);
    expect(onFilesChanged).not.toHaveBeenCalled();

    getCallback(callbacks, 0)(null, [
      { path: "/root/a/sessions-index.json", type: "update" as const },
    ]);
    await vi.advanceTimersByTimeAsync(50);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
  });

  it("prevents overlapping processing and flushes accumulated paths after", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    let finishProcessing: (() => void) | null = null;
    const onFilesChanged = vi.fn(
      (_batch: FileWatcherBatch) =>
        new Promise<void>((resolve) => {
          finishProcessing = () => resolve();
        }),
    );

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 10,
    });
    await service.start();

    // First batch
    getCallback(callbacks, 0)(null, [{ path: "/root/a/first.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    expect(onFilesChanged).toHaveBeenCalledWith({
      changedPaths: ["/root/a/first.jsonl"],
      requiresFullScan: false,
    });

    // While processing, new event arrives
    getCallback(callbacks, 0)(null, [{ path: "/root/a/second.jsonl", type: "create" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    // Should not start second processing while first is in-flight
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    // First processing completes — should immediately flush the accumulated second batch
    const completeFirstBatch =
      finishProcessing ??
      (() => {
        throw new Error("Expected in-flight processing resolver");
      });
    completeFirstBatch();
    await vi.advanceTimersByTimeAsync(0);

    expect(onFilesChanged).toHaveBeenCalledTimes(2);
    expect(onFilesChanged).toHaveBeenLastCalledWith({
      changedPaths: ["/root/a/second.jsonl"],
      requiresFullScan: false,
    });
  });

  it("start() is a no-op when already running", async () => {
    const { subscribe } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe });
    await service.start();
    await service.start();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("stop() is a no-op when not running", async () => {
    const { subscribe } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe });

    await service.stop();
    expect(service.isRunning()).toBe(false);
  });

  it("stop() clears pending paths and debounce timer", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 50,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [{ path: "/root/a/file.json", type: "update" as const }]);
    await service.stop();

    await vi.advanceTimersByTimeAsync(100);
    expect(onFilesChanged).not.toHaveBeenCalled();
  });

  it("stop() prevents in-flight processing from re-triggering flush", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    let finishProcessing: (() => void) | null = null;
    const onFilesChanged = vi.fn(
      (_batch: FileWatcherBatch) =>
        new Promise<void>((resolve) => {
          finishProcessing = () => resolve();
        }),
    );

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 10,
    });
    await service.start();

    // Start first batch
    getCallback(callbacks, 0)(null, [{ path: "/root/a/first.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    // Accumulate while processing
    getCallback(callbacks, 0)(null, [{ path: "/root/a/second.jsonl", type: "create" as const }]);

    // Stop while first batch is processing — resolve concurrently so stop can drain
    const stopPromise = service.stop();
    const completeInFlightBatch =
      finishProcessing ??
      (() => {
        throw new Error("Expected in-flight processing resolver");
      });
    completeInFlightBatch();
    await stopPromise;
    await vi.advanceTimersByTimeAsync(0);

    // Should NOT have triggered second flush because stopped was set before flush completed
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
  });

  it("calls onError when subscribe callback receives an error", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();
    const onError = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, onError });
    await service.start();

    const error = new Error("watcher failed");
    getCallback(callbacks, 0)(error, []);

    expect(onError).toHaveBeenCalledWith(error);
    expect(onFilesChanged).not.toHaveBeenCalled();
  });

  it("calls onError when subscribe itself throws", async () => {
    const subscribe = vi.fn(async () => {
      throw new Error("subscribe failed");
    }) as unknown as SubscribeFn;
    const onFilesChanged = vi.fn();
    const onError = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, onError });
    await expect(service.start()).rejects.toThrow("No watcher subscriptions were established");

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "subscribe failed" }));
    expect(service.isRunning()).toBe(false);
  });

  it("calls onError when onFilesChanged throws", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const processingError = new Error("processing failed");
    const onFilesChanged = vi.fn(async (_batch: FileWatcherBatch) => {
      throw processingError;
    });
    const onError = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      onError,
      debounceMs: 10,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [{ path: "/root/a/file.json", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    expect(onError).toHaveBeenCalledWith(processingError);
  });

  it("requests a full scan when structural changes are observed", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 10,
    });
    await service.start();

    getCallback(callbacks, 0)(null, [{ path: "/root/a/2026", type: "create" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    expect(onFilesChanged).toHaveBeenCalledWith({
      changedPaths: [],
      requiresFullScan: true,
    });
  });

  it("passes subscribe options through to the watcher backend", async () => {
    const { subscribe } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      subscribeOptions: { backend: "kqueue" },
    });
    await service.start();

    expect(subscribe).toHaveBeenCalledWith("/root/a", expect.any(Function), { backend: "kqueue" });
  });

  it("reports pending queue status", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, {
      subscribe,
      debounceMs: 10,
    });
    await service.start();

    expect(service.getStatus()).toEqual({
      running: true,
      processing: false,
      pendingPathCount: 0,
    });

    getCallback(callbacks, 0)(null, [{ path: "/root/a/file.jsonl", type: "update" as const }]);
    expect(service.getStatus()).toEqual({
      running: true,
      processing: false,
      pendingPathCount: 1,
    });
  });
});
