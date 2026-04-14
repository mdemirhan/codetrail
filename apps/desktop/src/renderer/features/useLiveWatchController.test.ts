// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchLiveStatusResponse } from "../app/types";
import type { CodetrailClient } from "../lib/codetrailClient";
import { LIVE_STATUS_PUSH_DEBOUNCE_MS, useLiveWatchController } from "./useLiveWatchController";

type MinimalClient = Pick<CodetrailClient, "invoke" | "onLiveStatusChanged">;

function makeLiveStatusResponse(
  overrides: Partial<WatchLiveStatusResponse> = {},
): WatchLiveStatusResponse {
  return {
    enabled: true,
    instrumentationEnabled: false,
    updatedAt: new Date().toISOString(),
    providerCounts: {
      claude: 0,
      codex: 0,
      gemini: 0,
      cursor: 0,
      copilot: 0,
      copilot_cli: 0,
      opencode: 0,
    },
    sessions: [],
    revision: 1,
    claudeHookState: {
      installed: false,
      managed: false,
      managedEventNames: [],
      logPath: "/tmp/hooks.jsonl",
      settingsPath: "/tmp/settings.json",
      missingEventNames: [],
      lastError: null,
    },
    ...overrides,
  };
}

function createMockClient(): {
  client: MinimalClient;
  pushListeners: Set<() => void>;
  emitPush: () => void;
} {
  const pushListeners = new Set<() => void>();
  const client: MinimalClient = {
    invoke: vi.fn(async () => makeLiveStatusResponse() as never),
    onLiveStatusChanged: vi.fn((listener: () => void) => {
      pushListeners.add(listener);
      return () => {
        pushListeners.delete(listener);
      };
    }),
  };
  return {
    client,
    pushListeners,
    emitPush: () => {
      for (const listener of pushListeners) {
        listener();
      }
    },
  };
}

describe("useLiveWatchController push notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("subscribes to push notifications when live watch is active", () => {
    const { client } = createMockClient();

    renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "settings",
        refreshStrategy: "watch-1s",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    expect(client.onLiveStatusChanged).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe when live watch is inactive", () => {
    const { client } = createMockClient();

    renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "settings",
        refreshStrategy: "off",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    expect(client.onLiveStatusChanged).not.toHaveBeenCalled();
  });

  it("does not subscribe when live status is not visible", () => {
    const { client } = createMockClient();

    renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "help",
        refreshStrategy: "watch-1s",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    expect(client.onLiveStatusChanged).not.toHaveBeenCalled();
  });

  it("calls loadLiveStatus on push notification", async () => {
    const { client, emitPush } = createMockClient();

    renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "settings",
        refreshStrategy: "watch-1s",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    const invokeCallsBefore = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => {
      emitPush();
      await vi.advanceTimersByTimeAsync(LIVE_STATUS_PUSH_DEBOUNCE_MS);
    });

    const invokeCallsAfter = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(invokeCallsAfter).toBeGreaterThan(invokeCallsBefore);
  });

  it("debounces rapid push notifications", async () => {
    const { client, emitPush } = createMockClient();

    renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "settings",
        refreshStrategy: "watch-1s",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    const invokeCallsBefore = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => {
      emitPush();
      emitPush();
      emitPush();
      emitPush();
      emitPush();
      await vi.advanceTimersByTimeAsync(LIVE_STATUS_PUSH_DEBOUNCE_MS);
    });

    const invokeCallsAfter = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;
    // Should only fire once despite 5 rapid pushes (debounce coalesces them)
    expect(invokeCallsAfter - invokeCallsBefore).toBe(1);
  });

  it("unsubscribes from push notifications on cleanup", () => {
    const { client, pushListeners } = createMockClient();

    const { unmount } = renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "settings",
        refreshStrategy: "watch-1s",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    expect(pushListeners.size).toBe(1);

    unmount();

    expect(pushListeners.size).toBe(0);
  });

  it("clears pending debounce timer on cleanup", async () => {
    const { client, emitPush } = createMockClient();

    const { unmount } = renderHook(() =>
      useLiveWatchController({
        codetrail: client,
        mainView: "settings",
        refreshStrategy: "watch-1s",
        liveWatchEnabled: true,
        claudeEnabled: false,
        claudeHooksPrompted: false,
        logError: vi.fn(),
      }),
    );

    // Emit a push that starts the debounce timer
    await act(async () => {
      emitPush();
    });

    const invokeCallsBefore = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;

    // Unmount before the debounce fires
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_STATUS_PUSH_DEBOUNCE_MS + 50);
    });

    // The debounced call should not fire after unmount
    const invokeCallsAfter = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(invokeCallsAfter).toBe(invokeCallsBefore);
  });
});
