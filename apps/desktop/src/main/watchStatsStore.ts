import type { IpcResponse } from "@codetrail/core";

export type WatchDiagnosticsSource =
  | "startup_incremental"
  | "manual_incremental"
  | "manual_force_reindex"
  | "watch_targeted"
  | "watch_fallback_incremental"
  | "watch_initial_scan";

type DiagnosticsBucket = IpcResponse<"watcher:getStats">["jobs"]["manualIncremental"];
type DiagnosticsSnapshot = IpcResponse<"watcher:getStats">;

function createBucket(): DiagnosticsBucket {
  return {
    runs: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: null,
  };
}

export class WatchStatsStore {
  private readonly startedAt = new Date().toISOString();
  private backend: DiagnosticsSnapshot["watcher"]["backend"] = null;
  private watchedRootCount = 0;
  private watchBasedTriggers = 0;
  private fallbackToIncrementalScans = 0;
  private lastTriggerAt: string | null = null;
  private lastTriggerPathCount: number | null = null;
  private completedRuns = 0;
  private failedRuns = 0;
  private readonly buckets: Record<WatchDiagnosticsSource, DiagnosticsBucket> = {
    startup_incremental: createBucket(),
    manual_incremental: createBucket(),
    manual_force_reindex: createBucket(),
    watch_targeted: createBucket(),
    watch_fallback_incremental: createBucket(),
    watch_initial_scan: createBucket(),
  };
  private lastRun: DiagnosticsSnapshot["lastRun"] = null;

  recordWatcherStart(input: {
    backend: DiagnosticsSnapshot["watcher"]["backend"];
    watchedRootCount: number;
  }): void {
    this.backend = input.backend;
    this.watchedRootCount = input.watchedRootCount;
  }

  recordWatcherTrigger(input: { changedPathCount: number; requiresFullScan: boolean }): void {
    this.watchBasedTriggers += 1;
    if (input.requiresFullScan) {
      this.fallbackToIncrementalScans += 1;
    }
    this.lastTriggerAt = new Date().toISOString();
    this.lastTriggerPathCount = input.changedPathCount;
  }

  recordJobSettled(input: {
    source: WatchDiagnosticsSource;
    durationMs: number;
    success: boolean;
  }): void {
    const bucket = this.buckets[input.source];
    bucket.runs += 1;
    bucket.totalDurationMs += input.durationMs;
    bucket.averageDurationMs = Math.round(bucket.totalDurationMs / bucket.runs);
    bucket.maxDurationMs = Math.max(bucket.maxDurationMs, input.durationMs);
    bucket.lastDurationMs = input.durationMs;

    if (input.success) {
      this.completedRuns += 1;
    } else {
      bucket.failedRuns += 1;
      this.failedRuns += 1;
    }

    this.lastRun = {
      source: input.source,
      completedAt: new Date().toISOString(),
      durationMs: input.durationMs,
      success: input.success,
    };
  }

  snapshot(): DiagnosticsSnapshot {
    return {
      startedAt: this.startedAt,
      watcher: {
        backend: this.backend,
        watchedRootCount: this.watchedRootCount,
        watchBasedTriggers: this.watchBasedTriggers,
        fallbackToIncrementalScans: this.fallbackToIncrementalScans,
        lastTriggerAt: this.lastTriggerAt,
        lastTriggerPathCount: this.lastTriggerPathCount,
      },
      jobs: {
        startupIncremental: this.buckets.startup_incremental,
        manualIncremental: this.buckets.manual_incremental,
        manualForceReindex: this.buckets.manual_force_reindex,
        watchTriggered: combineBuckets(
          this.buckets.watch_targeted,
          this.buckets.watch_fallback_incremental,
        ),
        watchTargeted: this.buckets.watch_targeted,
        watchFallbackIncremental: this.buckets.watch_fallback_incremental,
        watchInitialScan: this.buckets.watch_initial_scan,
        totals: {
          completedRuns: this.completedRuns,
          failedRuns: this.failedRuns,
        },
      },
      lastRun: this.lastRun,
    };
  }
}

function combineBuckets(...buckets: DiagnosticsBucket[]): DiagnosticsBucket {
  const combined = createBucket();
  for (const bucket of buckets) {
    combined.runs += bucket.runs;
    combined.failedRuns += bucket.failedRuns;
    combined.totalDurationMs += bucket.totalDurationMs;
    combined.maxDurationMs = Math.max(combined.maxDurationMs, bucket.maxDurationMs);
    combined.lastDurationMs = bucket.lastDurationMs ?? combined.lastDurationMs;
  }
  if (combined.runs > 0) {
    combined.averageDurationMs = Math.round(combined.totalDurationMs / combined.runs);
  }
  return combined;
}
