import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileWatcherOptions } from "./fileWatcherService";
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
    expect(subscribe).toHaveBeenCalledWith("/root/a", expect.any(Function));
    expect(subscribe).toHaveBeenCalledWith("/root/b", expect.any(Function));
    expect(service.isRunning()).toBe(true);
  });

  it("skips roots that do not exist", async () => {
    mockExistsSync.mockImplementation((p) => p !== "/root/missing");

    const { subscribe } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/exists", "/root/missing"], onFilesChanged, { subscribe });
    await service.start();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith("/root/exists", expect.any(Function));
  });

  it("unsubscribes all subscriptions on stop", async () => {
    const { subscribe, subscriptions } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a", "/root/b"], onFilesChanged, { subscribe });
    await service.start();
    await service.stop();

    expect(subscriptions[0]!.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriptions[1]!.unsubscribe).toHaveBeenCalledTimes(1);
    expect(service.isRunning()).toBe(false);
  });

  it("accumulates paths and passes them to callback after debounce", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 50 });
    await service.start();

    callbacks[0]!(null, [{ path: "/root/a/file1.json", type: "update" as const }]);
    callbacks[0]!(null, [{ path: "/root/a/file2.jsonl", type: "create" as const }]);

    expect(onFilesChanged).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    const paths = onFilesChanged.mock.calls[0]![0] as string[];
    expect(paths).toContain("/root/a/file1.json");
    expect(paths).toContain("/root/a/file2.jsonl");
  });

  it("deduplicates paths within a debounce window", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 50 });
    await service.start();

    callbacks[0]!(null, [{ path: "/root/a/same.jsonl", type: "update" as const }]);
    callbacks[0]!(null, [{ path: "/root/a/same.jsonl", type: "update" as const }]);
    callbacks[0]!(null, [{ path: "/root/a/same.jsonl", type: "update" as const }]);

    await vi.advanceTimersByTimeAsync(50);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    const paths = onFilesChanged.mock.calls[0]![0] as string[];
    expect(paths).toEqual(["/root/a/same.jsonl"]);
  });

  it("does not reset timer on new events — flushes at fixed interval from first event", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 50 });
    await service.start();

    callbacks[0]!(null, [{ path: "/root/a/file.json", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(40);
    expect(onFilesChanged).not.toHaveBeenCalled();

    // New event arrives but does NOT reset the timer
    callbacks[0]!(null, [{ path: "/root/a/other.json", type: "update" as const }]);

    // Original timer fires at t=50 (10ms from now), including both paths
    await vi.advanceTimersByTimeAsync(10);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    const paths = onFilesChanged.mock.calls[0]![0] as string[];
    expect(paths).toContain("/root/a/file.json");
    expect(paths).toContain("/root/a/other.json");
  });

  it("starts a new timer after flush completes for events that arrive during continuous activity", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 50 });
    await service.start();

    // First batch
    callbacks[0]!(null, [{ path: "/root/a/batch1.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    // Second batch — new timer starts
    callbacks[0]!(null, [{ path: "/root/a/batch2.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(onFilesChanged).toHaveBeenCalledTimes(2);
    expect(onFilesChanged).toHaveBeenLastCalledWith(["/root/a/batch2.jsonl"]);
  });

  it("only accumulates .json and .jsonl files", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const onFilesChanged = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 50 });
    await service.start();

    callbacks[0]!(null, [
      { path: "/root/a/file.txt", type: "update" as const },
      { path: "/root/a/file.ts", type: "update" as const },
      { path: "/root/a/file.log", type: "create" as const },
    ]);

    await vi.advanceTimersByTimeAsync(100);
    expect(onFilesChanged).not.toHaveBeenCalled();

    callbacks[0]!(null, [{ path: "/root/a/sessions-index.json", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
  });

  it("prevents overlapping processing and flushes accumulated paths after", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    let resolveProcessing: (() => void) | null = null;
    const onFilesChanged = vi.fn(
      (_paths: string[]) =>
        new Promise<void>((resolve) => {
          resolveProcessing = resolve;
        }),
    );

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 10 });
    await service.start();

    // First batch
    callbacks[0]!(null, [{ path: "/root/a/first.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    expect(onFilesChanged).toHaveBeenCalledWith(["/root/a/first.jsonl"]);

    // While processing, new event arrives
    callbacks[0]!(null, [{ path: "/root/a/second.jsonl", type: "create" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    // Should not start second processing while first is in-flight
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    // First processing completes — should immediately flush the accumulated second batch
    resolveProcessing!();
    await vi.advanceTimersByTimeAsync(0);

    expect(onFilesChanged).toHaveBeenCalledTimes(2);
    expect(onFilesChanged).toHaveBeenLastCalledWith(["/root/a/second.jsonl"]);
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

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 50 });
    await service.start();

    callbacks[0]!(null, [{ path: "/root/a/file.json", type: "update" as const }]);
    await service.stop();

    await vi.advanceTimersByTimeAsync(100);
    expect(onFilesChanged).not.toHaveBeenCalled();
  });

  it("stop() prevents in-flight processing from re-triggering flush", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    let resolveProcessing: (() => void) | null = null;
    const onFilesChanged = vi.fn(
      (_paths: string[]) =>
        new Promise<void>((resolve) => {
          resolveProcessing = resolve;
        }),
    );

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, debounceMs: 10 });
    await service.start();

    // Start first batch
    callbacks[0]!(null, [{ path: "/root/a/first.jsonl", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    // Accumulate while processing
    callbacks[0]!(null, [{ path: "/root/a/second.jsonl", type: "create" as const }]);

    // Stop while first batch is processing — resolve concurrently so stop can drain
    const stopPromise = service.stop();
    resolveProcessing!();
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
    callbacks[0]!(error, []);

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
    await service.start();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "subscribe failed" }));
    expect(service.isRunning()).toBe(true);
  });

  it("calls onError when onFilesChanged throws", async () => {
    const { subscribe, callbacks } = createMockSubscribe();
    const processingError = new Error("processing failed");
    const onFilesChanged = vi.fn(async (_paths: string[]) => {
      throw processingError;
    });
    const onError = vi.fn();

    const service = new FileWatcherService(["/root/a"], onFilesChanged, { subscribe, onError, debounceMs: 10 });
    await service.start();

    callbacks[0]!(null, [{ path: "/root/a/file.json", type: "update" as const }]);
    await vi.advanceTimersByTimeAsync(10);

    expect(onError).toHaveBeenCalledWith(processingError);
  });
});
