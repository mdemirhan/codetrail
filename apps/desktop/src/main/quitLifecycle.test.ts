import { describe, expect, it, vi } from "vitest";

import { createBeforeQuitHandler } from "./quitLifecycle";

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => {
      if (!resolve) {
        throw new Error("Deferred resolve was not initialized");
      }
      resolve(value);
    },
    reject: (reason?: unknown) => {
      if (!reject) {
        throw new Error("Deferred reject was not initialized");
      }
      reject(reason);
    },
  };
}

describe("createBeforeQuitHandler", () => {
  it("prevents the first quit, waits for shutdown, then exits immediately", async () => {
    const shutdown = createDeferred<void>();
    const flushAppState = vi.fn();
    const writeDebugLog = vi.fn();
    const exitApp = vi.fn();
    const preventDefault = vi.fn();

    const handler = createBeforeQuitHandler({
      flushAppState,
      writeDebugLog,
      shutdownMainProcess: () => shutdown.promise,
      exitApp,
    });

    handler({ preventDefault });

    expect(writeDebugLog).toHaveBeenCalledWith("before-quit");
    expect(flushAppState).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();

    shutdown.resolve();
    await shutdown.promise;
    await Promise.resolve();

    expect(exitApp).toHaveBeenCalledWith(0);
  });

  it("does not start shutdown twice when quit is requested again mid-shutdown", () => {
    const shutdown = createDeferred<void>();
    const flushAppState = vi.fn();
    const writeDebugLog = vi.fn();
    const exitApp = vi.fn();
    const firstPreventDefault = vi.fn();
    const secondPreventDefault = vi.fn();
    const shutdownMainProcess = vi.fn(() => shutdown.promise);

    const handler = createBeforeQuitHandler({
      flushAppState,
      writeDebugLog,
      shutdownMainProcess,
      exitApp,
    });

    handler({ preventDefault: firstPreventDefault });
    handler({ preventDefault: secondPreventDefault });

    expect(flushAppState).toHaveBeenCalledTimes(2);
    expect(writeDebugLog).toHaveBeenCalledTimes(2);
    expect(firstPreventDefault).toHaveBeenCalledTimes(1);
    expect(secondPreventDefault).not.toHaveBeenCalled();
    expect(shutdownMainProcess).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("still exits if shutdown cleanup fails", async () => {
    const shutdownError = new Error("unsubscribe failed");
    const logShutdownError = vi.fn();
    const exitApp = vi.fn();
    const handler = createBeforeQuitHandler({
      flushAppState: vi.fn(),
      writeDebugLog: vi.fn(),
      shutdownMainProcess: async () => {
        throw shutdownError;
      },
      exitApp,
      logShutdownError,
    });

    handler({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(logShutdownError).toHaveBeenCalledWith(shutdownError);
    expect(exitApp).toHaveBeenCalledWith(0);
  });
});
