import { describe, expect, it } from "vitest";

import { WatchStatsStore } from "./watchStatsStore";

describe("WatchStatsStore", () => {
  it("starts with an empty in-memory snapshot", () => {
    const store = new WatchStatsStore();

    expect(store.snapshot()).toEqual({
      startedAt: expect.any(String),
      watcher: {
        backend: null,
        watchedRootCount: 0,
        watchBasedTriggers: 0,
        fallbackToIncrementalScans: 0,
        lastTriggerAt: null,
        lastTriggerPathCount: null,
      },
      jobs: {
        startupIncremental: emptyBucket(),
        manualIncremental: emptyBucket(),
        manualForceReindex: emptyBucket(),
        watchTriggered: emptyBucket(),
        watchTargeted: emptyBucket(),
        watchFallbackIncremental: emptyBucket(),
        watchInitialScan: emptyBucket(),
        totals: {
          completedRuns: 0,
          failedRuns: 0,
        },
      },
      lastRun: null,
    });
  });

  it("records watcher lifecycle and aggregates watch-triggered runs", () => {
    const store = new WatchStatsStore();

    store.recordWatcherStart({ backend: "kqueue", watchedRootCount: 5 });
    store.recordWatcherTrigger({ changedPathCount: 2, requiresFullScan: false });
    store.recordWatcherTrigger({ changedPathCount: 0, requiresFullScan: true });
    store.recordJobSettled({ source: "manual_incremental", durationMs: 150, success: true });
    store.recordJobSettled({ source: "watch_targeted", durationMs: 80, success: true });
    store.recordJobSettled({
      source: "watch_fallback_incremental",
      durationMs: 120,
      success: false,
    });

    expect(store.snapshot()).toEqual({
      startedAt: expect.any(String),
      watcher: {
        backend: "kqueue",
        watchedRootCount: 5,
        watchBasedTriggers: 2,
        fallbackToIncrementalScans: 1,
        lastTriggerAt: expect.any(String),
        lastTriggerPathCount: 0,
      },
      jobs: {
        startupIncremental: emptyBucket(),
        manualIncremental: {
          runs: 1,
          failedRuns: 0,
          totalDurationMs: 150,
          averageDurationMs: 150,
          maxDurationMs: 150,
          lastDurationMs: 150,
        },
        manualForceReindex: emptyBucket(),
        watchTriggered: {
          runs: 2,
          failedRuns: 1,
          totalDurationMs: 200,
          averageDurationMs: 100,
          maxDurationMs: 120,
          lastDurationMs: 120,
        },
        watchTargeted: {
          runs: 1,
          failedRuns: 0,
          totalDurationMs: 80,
          averageDurationMs: 80,
          maxDurationMs: 80,
          lastDurationMs: 80,
        },
        watchFallbackIncremental: {
          runs: 1,
          failedRuns: 1,
          totalDurationMs: 120,
          averageDurationMs: 120,
          maxDurationMs: 120,
          lastDurationMs: 120,
        },
        watchInitialScan: emptyBucket(),
        totals: {
          completedRuns: 2,
          failedRuns: 1,
        },
      },
      lastRun: {
        source: "watch_fallback_incremental",
        completedAt: expect.any(String),
        durationMs: 120,
        success: false,
      },
    });
  });
});

function emptyBucket() {
  return {
    runs: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: null,
  };
}
