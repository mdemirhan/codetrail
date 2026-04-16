import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";

import {
  CLAUDE_HOOK_EVENT_NAME_VALUES,
  type DiscoveryConfig,
  type IpcResponse,
  type LiveSessionState,
  type PrefetchedJsonlChunk,
  createInitialLiveSessionState,
  discoverSingleFile,
  getProviderAdapter,
} from "@codetrail/core";

import type { QueryService, RecentLiveSessionFile } from "./data/queryService";
import {
  type FileWatcherBatch,
  type FileWatcherOptions,
  FileWatcherService,
} from "./fileWatcherService";
import {
  type ClaudeHookState,
  buildClaudeManagedHookCommand,
  ensureRecord,
  entryHasExactManagedHookCommand,
  getClaudeHookLogPath,
  getClaudeSettingsPath,
  inspectClaudeHookState,
  prepareClaudeHookLogForAppStart,
  removeManagedHooksFromEntry,
  updateClaudeSettingsJson,
} from "./live/claudeHookSettings";
import {
  appendLiveInstrumentationRecord,
  areInstrumentationValuesEqual,
  getLiveTraceLogPath,
  summarizeLiveLine,
  summarizeLiveSessionState,
} from "./live/liveInstrumentation";
import { buildLiveStatusSnapshot, pruneStaleSessionCursors } from "./live/liveSnapshot";

const STARTUP_SEED_WINDOW_MS = 90_000;
const STARTUP_SEED_LIMIT = 24;
const REPAIR_PAGE_SIZE = 100;
const INITIAL_TAIL_BYTES = 32 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const IDLE_TIMEOUT_MS = 120_000;
const PRUNE_AFTER_MS = 180_000;
const HOOK_WATCH_DEBOUNCE_MS = 250;

type FileCursorState = {
  filePath: string;
  offset: number;
  lastSize: number;
  lastMtimeMs: number;
  partialLineBuffer: string;
  session: LiveSessionState;
};

type RecentLiveSessionCandidate = RecentLiveSessionFile & {
  provider: LiveTrackedProvider;
};

type LiveTrackedProvider = RecentLiveSessionFile["provider"];

type LiveSessionRepairResult = {
  ran: boolean;
  candidateCount: number;
  recoveredSessionCount: number;
  repairedTrackedSessionCount: number;
  consumedStructuralInvalidation: boolean;
  staleCandidateCountAfterRepair: number;
};

type LiveSessionRepairInput = {
  minFileMtimeMs: number;
};

type RepairPassSummary = {
  candidateCount: number;
  recoveredSessionCount: number;
  repairedTrackedSessionCount: number;
};

export type LiveSessionStoreOptions = {
  queryService: Pick<QueryService, "listRecentLiveSessionFiles">;
  userDataDir: string;
  homeDir: string;
  instrumentationEnabled?: boolean;
  now?: () => number;
  onBackgroundError?: (message: string, error: unknown, details?: Record<string, unknown>) => void;
  onSnapshotInvalidated?: () => void;
  createFileWatcher?: (
    roots: string[],
    onFilesChanged: (batch: FileWatcherBatch) => void | Promise<void>,
    options?: FileWatcherOptions,
  ) => FileWatcherService;
};

export class LiveSessionStore {
  private readonly queryService: Pick<QueryService, "listRecentLiveSessionFiles">;
  private readonly userDataDir: string;
  private readonly homeDir: string;
  private readonly instrumentationEnabled: boolean;
  private readonly now: () => number;
  private readonly onBackgroundError:
    | ((message: string, error: unknown, details?: Record<string, unknown>) => void)
    | undefined;
  private readonly onSnapshotInvalidated: (() => void) | undefined;
  private readonly createFileWatcher: NonNullable<LiveSessionStoreOptions["createFileWatcher"]>;

  private enabled = false;
  private discoveryConfig: DiscoveryConfig | null = null;
  private readonly sessionCursors = new Map<string, FileCursorState>();
  private readonly hookCursor = {
    offset: 0,
    lastSize: 0,
    lastMtimeMs: 0,
    partialLineBuffer: "",
  };
  private hookWatcher: FileWatcherService | null = null;
  private claudeHookState: ClaudeHookState;
  private snapshotCache: IpcResponse<"watcher:getLiveStatus"> | null = null;
  private snapshotCacheExpiresAtMs = 0;
  private snapshotDirty = true;
  private revision = 0;
  private hookLogPreparedForAppStart = false;
  private readonly indexingPrefetchByFilePath = new Map<string, PrefetchedJsonlChunk>();
  private readonly liveTraceLogPath: string;
  private structuralInvalidationPending = false;
  private structuralInvalidationObservedAtMs: number | null = null;

  constructor(options: LiveSessionStoreOptions) {
    this.queryService = options.queryService;
    this.userDataDir = options.userDataDir;
    this.homeDir = options.homeDir;
    this.instrumentationEnabled = options.instrumentationEnabled ?? false;
    this.now = options.now ?? (() => Date.now());
    this.onBackgroundError = options.onBackgroundError;
    this.onSnapshotInvalidated = options.onSnapshotInvalidated;
    this.createFileWatcher =
      options.createFileWatcher ??
      ((roots, onFilesChanged, watcherOptions) =>
        new FileWatcherService(roots, onFilesChanged, watcherOptions));
    this.claudeHookState = this.inspectClaudeHookState();
    this.liveTraceLogPath = getLiveTraceLogPath(this.userDataDir);
  }

  async start(input: { discoveryConfig: DiscoveryConfig }): Promise<void> {
    this.enabled = true;
    this.discoveryConfig = input.discoveryConfig;
    this.clearStructuralInvalidation();
    this.sessionCursors.clear();
    this.resetHookCursor();
    this.invalidateSnapshotCache();
    this.claudeHookState = this.inspectClaudeHookState();
    await this.refreshClaudeHookWatcher();
    await this.seedRecentSessions();
  }

  async prepareClaudeHookLogForAppStart(): Promise<void> {
    if (this.hookLogPreparedForAppStart) {
      return;
    }
    await prepareClaudeHookLogForAppStart(this.getClaudeHookLogPath());
    this.resetHookCursor();
    this.hookLogPreparedForAppStart = true;
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.clearStructuralInvalidation();
    this.sessionCursors.clear();
    this.indexingPrefetchByFilePath.clear();
    this.invalidateSnapshotCache();
    await this.stopHookWatcher();
  }

  takeIndexingPrefetchedJsonlChunks(changedPaths: string[]): PrefetchedJsonlChunk[] {
    const chunks: PrefetchedJsonlChunk[] = [];
    for (const changedPath of changedPaths) {
      const chunk = this.indexingPrefetchByFilePath.get(changedPath);
      if (!chunk) {
        continue;
      }
      this.indexingPrefetchByFilePath.delete(changedPath);
      chunks.push(chunk);
    }
    return chunks;
  }

  noteStructuralInvalidation(observedAtMs: number): void {
    if (!this.enabled || !this.discoveryConfig) {
      return;
    }
    this.structuralInvalidationPending = true;
    this.structuralInvalidationObservedAtMs ??= observedAtMs;
  }

  hasStructuralInvalidationPending(): boolean {
    return this.structuralInvalidationPending;
  }

  getStructuralInvalidationObservedAtMs(): number | null {
    return this.structuralInvalidationObservedAtMs;
  }

  async catchUpTrackedTranscriptsAfterWatcherRestart(input: {
    restartStartedAtMs: number;
  }): Promise<{ processedTrackedFileCount: number }> {
    let processedTrackedFileCount = 0;
    const trackedFilePaths = [...this.sessionCursors.keys()];
    const results = await Promise.allSettled(
      trackedFilePaths.map(async (filePath) => {
        const cursor = this.sessionCursors.get(filePath);
        if (!cursor) {
          return;
        }
        const fileStat = await safeStat(filePath);
        if (!fileStat?.isFile()) {
          this.sessionCursors.delete(filePath);
          this.indexingPrefetchByFilePath.delete(filePath);
          this.invalidateSnapshotCache();
          processedTrackedFileCount += 1;
          return;
        }
        const fileMtimeMs = Math.trunc(fileStat.mtimeMs);
        const changedDuringRestart =
          fileStat.size > cursor.lastSize ||
          (fileMtimeMs > cursor.lastMtimeMs && fileMtimeMs >= input.restartStartedAtMs);
        if (!changedDuringRestart) {
          return;
        }
        await this.processTranscriptPath(filePath);
        processedTrackedFileCount += 1;
      }),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.reportBackgroundError(
          "Failed catching up tracked live transcript after watcher restart",
          result.reason,
          {
            filePath: trackedFilePaths[index],
          },
        );
      }
    });
    return { processedTrackedFileCount };
  }

  async repairRecentSessionsAfterIndexing(
    input: LiveSessionRepairInput,
  ): Promise<LiveSessionRepairResult> {
    if (!this.enabled || !this.discoveryConfig) {
      return {
        ran: false,
        candidateCount: 0,
        recoveredSessionCount: 0,
        repairedTrackedSessionCount: 0,
        consumedStructuralInvalidation: false,
        staleCandidateCountAfterRepair: 0,
      };
    }

    const consumedStructuralInvalidation = this.structuralInvalidationPending;
    const providers = this.getRecentLiveProviders();
    let candidateCount = 0;
    let recoveredSessionCount = 0;
    let repairedTrackedSessionCount = 0;
    try {
      const initialRepair = await this.repairCandidatesSince({
        providers,
        minFileMtimeMs: input.minFileMtimeMs,
      });
      candidateCount = initialRepair.candidateCount;
      recoveredSessionCount = initialRepair.recoveredSessionCount;
      repairedTrackedSessionCount = initialRepair.repairedTrackedSessionCount;
      const staleCandidatesAfterRepair = await this.collectStaleRecentSessionCandidatesSince({
        providers,
        minFileMtimeMs: input.minFileMtimeMs,
      });
      const staleCandidateCountAfterRepair = staleCandidatesAfterRepair.length;
      const repairedCleanly = staleCandidateCountAfterRepair === 0;
      if (consumedStructuralInvalidation && repairedCleanly) {
        this.clearStructuralInvalidation();
      }
      return {
        ran: true,
        recoveredSessionCount,
        candidateCount,
        repairedTrackedSessionCount,
        consumedStructuralInvalidation: consumedStructuralInvalidation && repairedCleanly,
        staleCandidateCountAfterRepair,
      };
    } catch (error) {
      this.reportBackgroundError("Failed repairing recent live sessions after indexing", error, {
        consumedStructuralInvalidation,
        candidateCount,
      });
      return {
        ran: false,
        candidateCount,
        recoveredSessionCount,
        repairedTrackedSessionCount,
        consumedStructuralInvalidation: false,
        staleCandidateCountAfterRepair: 0,
      };
    }
  }

  async handleWatcherBatch(batch: FileWatcherBatch): Promise<void> {
    if (!this.enabled || !this.discoveryConfig) {
      return;
    }

    const changedPaths = [...new Set(batch.changedPaths)];
    const results = await Promise.allSettled(
      changedPaths.map((changedPath) => this.processTranscriptPath(changedPath)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.reportBackgroundError("Failed processing live transcript update", result.reason, {
          filePath: changedPaths[index],
        });
      }
    });
  }

  async installClaudeHooks(): Promise<ClaudeHookState> {
    const settingsPath = this.getClaudeSettingsPath();
    const logPath = this.getClaudeHookLogPath();
    const managedCommand = buildClaudeManagedHookCommand(logPath);
    await this.updateClaudeSettingsJson(settingsPath, (settings) => {
      const hooksRecord = ensureRecord(settings, "hooks");

      for (const eventName of CLAUDE_HOOK_EVENT_NAME_VALUES) {
        const currentEntries = Array.isArray(hooksRecord[eventName]) ? hooksRecord[eventName] : [];
        const alreadyInstalled = currentEntries.some((entry) =>
          entryHasExactManagedHookCommand(entry, managedCommand),
        );
        if (alreadyInstalled) {
          hooksRecord[eventName] = currentEntries;
          continue;
        }
        hooksRecord[eventName] = [
          ...currentEntries,
          {
            hooks: [
              {
                type: "command",
                command: managedCommand,
                async: true,
              },
            ],
          },
        ];
      }
      return settings;
    });

    await mkdir(dirname(logPath), { recursive: true });
    this.claudeHookState = this.inspectClaudeHookState();
    this.invalidateSnapshotCache();
    await this.refreshClaudeHookWatcher();
    return this.claudeHookState;
  }

  async removeClaudeHooks(): Promise<ClaudeHookState> {
    const settingsPath = this.getClaudeSettingsPath();
    await this.updateClaudeSettingsJson(settingsPath, (settings) => {
      const hooksRecord = ensureRecord(settings, "hooks");

      for (const eventName of Object.keys(hooksRecord)) {
        const currentEntries = Array.isArray(hooksRecord[eventName]) ? hooksRecord[eventName] : [];
        const nextEntries = currentEntries
          .map((entry) => removeManagedHooksFromEntry(entry))
          .filter((entry) => entry !== null);
        if (nextEntries.length === 0) {
          delete hooksRecord[eventName];
          continue;
        }
        hooksRecord[eventName] = nextEntries;
      }
      return settings;
    });
    this.claudeHookState = this.inspectClaudeHookState();
    this.invalidateSnapshotCache();
    await this.refreshClaudeHookWatcher();
    return this.claudeHookState;
  }

  async refreshClaudeHookWatcher(): Promise<void> {
    this.claudeHookState = this.inspectClaudeHookState();
    this.invalidateSnapshotCache();
    if (!this.enabled || !this.claudeHookState.installed) {
      await this.stopHookWatcher();
      return;
    }

    if (this.hookWatcher) {
      return;
    }

    await mkdir(dirname(this.claudeHookState.logPath), { recursive: true });
    const watcher = this.createFileWatcher(
      [dirname(this.claudeHookState.logPath)],
      async (batch) => {
        const changedPaths = [...new Set(batch.changedPaths)];
        for (const changedPath of changedPaths) {
          if (changedPath === this.claudeHookState.logPath) {
            try {
              await this.processClaudeHookLogFile(changedPath);
            } catch (error) {
              this.reportBackgroundError("Failed processing Claude hook log update", error, {
                filePath: changedPath,
              });
            }
            break;
          }
        }
      },
      {
        debounceMs: HOOK_WATCH_DEBOUNCE_MS,
      },
    );
    await watcher.start();
    this.hookWatcher = watcher;
  }

  snapshot(): IpcResponse<"watcher:getLiveStatus"> {
    const nowMs = this.now();
    if (this.snapshotCache && !this.snapshotDirty && nowMs < this.snapshotCacheExpiresAtMs) {
      return this.snapshotCache;
    }
    const prunedAnySessions = pruneStaleSessionCursors(this.sessionCursors, nowMs, PRUNE_AFTER_MS);
    const previousSnapshot = this.snapshotCache;
    const nextSnapshotState = buildLiveStatusSnapshot({
      enabled: this.enabled,
      instrumentationEnabled: this.instrumentationEnabled,
      nowMs,
      sessionCursors: this.sessionCursors,
      claudeHookState: this.claudeHookState,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      pruneAfterMs: PRUNE_AFTER_MS,
      previousSnapshot,
      previousRevision: this.revision,
    });
    const revisionChanged = nextSnapshotState.revision !== this.revision;
    if (prunedAnySessions || revisionChanged) {
      this.revision = nextSnapshotState.revision;
    }
    this.snapshotCache = nextSnapshotState.snapshot;
    this.snapshotDirty = false;
    this.snapshotCacheExpiresAtMs = nextSnapshotState.expiresAtMs;
    if (prunedAnySessions || !previousSnapshot || revisionChanged) {
      if (this.instrumentationEnabled) {
        this.recordTrace({
          kind: "live_snapshot",
          now: new Date(nowMs).toISOString(),
          revision: nextSnapshotState.revision,
          prunedAnySessions,
          enabled: nextSnapshotState.snapshot.enabled,
          sessions: nextSnapshotState.snapshot.sessions.map((session) => ({
            provider: session.provider,
            sessionIdentity: session.sessionIdentity,
            sourceSessionId: session.sourceSessionId,
            statusKind: session.statusKind,
            statusText: session.statusText,
            detailText: session.detailText,
            sourcePrecision: session.sourcePrecision,
            bestEffort: session.bestEffort,
            lastActivityAt: session.lastActivityAt,
            filePath: session.filePath,
          })),
        });
      }
    }
    return nextSnapshotState.snapshot;
  }

  private async seedRecentSessions(): Promise<void> {
    if (!this.discoveryConfig) {
      return;
    }

    const providers = this.getRecentLiveProviders();
    const cutoffMs = this.now() - STARTUP_SEED_WINDOW_MS;
    const candidates = this.listRecentSessionCandidatePage({
      providers,
      minFileMtimeMs: cutoffMs,
      limit: STARTUP_SEED_LIMIT,
    });
    await this.ingestRecentSessionCandidates(candidates, {
      initialTailBytes: INITIAL_TAIL_BYTES,
    });
  }

  private getRecentLiveProviders(): LiveTrackedProvider[] {
    return (
      this.discoveryConfig?.enabledProviders?.filter(
        (provider): provider is LiveTrackedProvider =>
          getProviderAdapter(provider).liveSession != null,
      ) ?? []
    );
  }

  private async ingestRecentSessionCandidates(
    candidates: RecentLiveSessionCandidate[],
    options: {
      initialTailBytes: number;
    },
  ): Promise<number> {
    if (candidates.length === 0) {
      return 0;
    }

    const trackedFilePathsBeforeIngestion = new Set(this.sessionCursors.keys());
    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        this.processTranscriptPath(candidate.filePath, {
          initialTailBytes: options.initialTailBytes,
        }),
      ),
    );
    let recoveredSessionCount = 0;
    results.forEach((result, index) => {
      const candidate = candidates[index];
      if (result.status === "rejected") {
        this.reportBackgroundError("Failed ingesting recent live transcript", result.reason, {
          filePath: candidate?.filePath,
        });
        return;
      }
      if (
        candidate &&
        !trackedFilePathsBeforeIngestion.has(candidate.filePath) &&
        this.sessionCursors.has(candidate.filePath)
      ) {
        recoveredSessionCount += 1;
      }
    });
    return recoveredSessionCount;
  }

  private partitionRecentSessionCandidates(candidates: RecentLiveSessionCandidate[]): {
    untrackedCandidates: RecentLiveSessionCandidate[];
    trackedIncrementalCandidates: RecentLiveSessionCandidate[];
    trackedReplayCandidates: RecentLiveSessionCandidate[];
  } {
    const untrackedCandidates: RecentLiveSessionCandidate[] = [];
    const trackedIncrementalCandidates: RecentLiveSessionCandidate[] = [];
    const trackedReplayCandidates: RecentLiveSessionCandidate[] = [];
    for (const candidate of candidates) {
      const cursor = this.sessionCursors.get(candidate.filePath);
      if (!cursor) {
        untrackedCandidates.push(candidate);
        continue;
      }
      if (!this.isRecentSessionCandidateHealthy(candidate, cursor)) {
        if (candidate.fileSize === cursor.lastSize) {
          trackedReplayCandidates.push(candidate);
        } else {
          trackedIncrementalCandidates.push(candidate);
        }
      }
    }
    return { untrackedCandidates, trackedIncrementalCandidates, trackedReplayCandidates };
  }

  private async repairCandidatesSince(input: {
    providers: LiveTrackedProvider[];
    minFileMtimeMs: number;
  }): Promise<RepairPassSummary> {
    let candidateCount = 0;
    let recoveredSessionCount = 0;
    let repairedTrackedSessionCount = 0;
    await this.forEachRecentSessionCandidatePage(input, async (page) => {
      candidateCount += page.length;
      const pageBuckets = this.partitionRecentSessionCandidates(page);
      await this.ingestRecentSessionCandidates(pageBuckets.untrackedCandidates, {
        initialTailBytes: INITIAL_TAIL_BYTES,
      });
      await this.ingestRecentSessionCandidates(pageBuckets.trackedIncrementalCandidates, {
        initialTailBytes: INITIAL_TAIL_BYTES,
      });
      await this.replayRecentSessionCandidatesFromStart(pageBuckets.trackedReplayCandidates);
      recoveredSessionCount += this.countHealthyRecentSessionCandidates(
        pageBuckets.untrackedCandidates,
      );
      repairedTrackedSessionCount += this.countHealthyRecentSessionCandidates([
        ...pageBuckets.trackedIncrementalCandidates,
        ...pageBuckets.trackedReplayCandidates,
      ]);
    });
    return {
      candidateCount,
      recoveredSessionCount,
      repairedTrackedSessionCount,
    };
  }

  private async collectStaleRecentSessionCandidatesSince(input: {
    providers: LiveTrackedProvider[];
    minFileMtimeMs: number;
  }): Promise<RecentLiveSessionCandidate[]> {
    const staleCandidates: RecentLiveSessionCandidate[] = [];
    await this.forEachRecentSessionCandidatePage(input, async (page) => {
      for (const candidate of page) {
        const cursor = this.sessionCursors.get(candidate.filePath);
        if (!cursor || !this.isRecentSessionCandidateHealthy(candidate, cursor)) {
          staleCandidates.push(candidate);
        }
      }
    });
    return staleCandidates;
  }

  private countHealthyRecentSessionCandidates(candidates: RecentLiveSessionCandidate[]): number {
    let healthyCount = 0;
    for (const candidate of candidates) {
      const cursor = this.sessionCursors.get(candidate.filePath);
      if (cursor && this.isRecentSessionCandidateHealthy(candidate, cursor)) {
        healthyCount += 1;
      }
    }
    return healthyCount;
  }

  private isRecentSessionCandidateHealthy(
    candidate: RecentLiveSessionCandidate,
    cursor: FileCursorState,
  ): boolean {
    return cursor.lastMtimeMs >= candidate.fileMtimeMs && cursor.lastSize >= candidate.fileSize;
  }

  private async replayRecentSessionCandidatesFromStart(
    candidates: RecentLiveSessionCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const previousCursor = this.cloneCursor(
          this.sessionCursors.get(candidate.filePath) ?? null,
        );
        this.sessionCursors.delete(candidate.filePath);
        this.indexingPrefetchByFilePath.delete(candidate.filePath);
        try {
          await this.processTranscriptPath(candidate.filePath);
        } catch (error) {
          if (previousCursor) {
            this.sessionCursors.set(candidate.filePath, previousCursor);
          }
          throw error;
        }
        if (!this.sessionCursors.has(candidate.filePath) && previousCursor) {
          this.sessionCursors.set(candidate.filePath, previousCursor);
        }
      }),
    );
    results.forEach((result, index) => {
      const candidate = candidates[index];
      if (result.status === "rejected") {
        this.reportBackgroundError(
          "Failed replaying recent live transcript from start",
          result.reason,
          {
            filePath: candidate?.filePath,
          },
        );
      }
    });
  }

  private async forEachRecentSessionCandidatePage(
    input: {
      providers: LiveTrackedProvider[];
      minFileMtimeMs: number;
    },
    visitor: (page: RecentLiveSessionCandidate[]) => Promise<void>,
  ): Promise<void> {
    for (let offset = 0; ; offset += REPAIR_PAGE_SIZE) {
      const page = this.listRecentSessionCandidatePage({
        providers: input.providers,
        minFileMtimeMs: input.minFileMtimeMs,
        limit: REPAIR_PAGE_SIZE,
        offset,
      });
      if (page.length === 0) {
        break;
      }
      await visitor(page);
      if (page.length < REPAIR_PAGE_SIZE) {
        break;
      }
    }
  }

  private listRecentSessionCandidatePage(input: {
    providers: LiveTrackedProvider[];
    minFileMtimeMs: number;
    limit: number;
    offset?: number;
  }): RecentLiveSessionCandidate[] {
    return this.queryService
      .listRecentLiveSessionFiles(input)
      .filter(
        (candidate): candidate is RecentLiveSessionCandidate =>
          getProviderAdapter(candidate.provider).liveSession != null,
      );
  }

  private cloneCursor(cursor: FileCursorState | null): FileCursorState | null {
    if (!cursor) {
      return null;
    }
    return {
      filePath: cursor.filePath,
      offset: cursor.offset,
      lastSize: cursor.lastSize,
      lastMtimeMs: cursor.lastMtimeMs,
      partialLineBuffer: cursor.partialLineBuffer,
      session: structuredClone(cursor.session),
    };
  }

  private async processTranscriptPath(
    filePath: string,
    options: { initialTailBytes?: number } = {},
  ): Promise<void> {
    if (!this.discoveryConfig) {
      return;
    }

    const discovered = discoverSingleFile(filePath, this.discoveryConfig);
    const liveHooks = discovered ? getProviderAdapter(discovered.provider).liveSession : null;
    if (!discovered || !liveHooks) {
      return;
    }

    const fileStat = await safeStat(filePath);
    if (!fileStat?.isFile()) {
      if (this.sessionCursors.delete(filePath)) {
        this.invalidateSnapshotCache();
      }
      return;
    }

    const cursor = this.ensureCursor(discovered.filePath, discovered);
    const previousOffset = cursor.offset;
    let readFrom = cursor.offset;
    let ignoreLeadingPartialLine = false;

    if (
      options.initialTailBytes &&
      cursor.offset === 0 &&
      fileStat.size > options.initialTailBytes
    ) {
      readFrom = fileStat.size - options.initialTailBytes;
      ignoreLeadingPartialLine = true;
      cursor.session.bestEffort = true;
      cursor.partialLineBuffer = "";
      if (this.instrumentationEnabled) {
        this.recordTrace({
          kind: "tail_window_applied",
          provider: discovered.provider,
          reason: "initial_tail",
          filePath,
          previousOffset,
          readFrom,
          fileSize: fileStat.size,
        });
      }
    } else if (fileStat.size < cursor.offset) {
      readFrom = Math.max(0, fileStat.size - INITIAL_TAIL_BYTES);
      ignoreLeadingPartialLine = readFrom > 0;
      cursor.offset = readFrom;
      cursor.lastSize = fileStat.size;
      cursor.partialLineBuffer = "";
      cursor.session.bestEffort = true;
      if (this.instrumentationEnabled) {
        this.recordTrace({
          kind: "tail_window_applied",
          provider: discovered.provider,
          reason: "truncated_file",
          filePath,
          previousOffset,
          readFrom,
          fileSize: fileStat.size,
        });
      }
    }

    let bytesToRead = fileStat.size - readFrom;
    if (bytesToRead <= 0) {
      cursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
      cursor.lastSize = fileStat.size;
      this.indexingPrefetchByFilePath.delete(filePath);
      return;
    }

    if (bytesToRead > MAX_READ_BYTES) {
      readFrom = fileStat.size - MAX_READ_BYTES;
      bytesToRead = MAX_READ_BYTES;
      ignoreLeadingPartialLine = true;
      cursor.partialLineBuffer = "";
      cursor.session.bestEffort = true;
      if (this.instrumentationEnabled) {
        this.recordTrace({
          kind: "tail_window_applied",
          provider: discovered.provider,
          reason: "max_read_window",
          filePath,
          previousOffset,
          readFrom,
          fileSize: fileStat.size,
          bytesToRead,
        });
      }
    }

    const buffer = await readBufferRange(filePath, readFrom, bytesToRead);
    const text = buffer.toString("utf8");
    if (!ignoreLeadingPartialLine && readFrom === previousOffset) {
      this.indexingPrefetchByFilePath.set(filePath, {
        filePath,
        fileSize: fileStat.size,
        fileMtimeMs: Math.trunc(fileStat.mtimeMs),
        startOffsetBytes: readFrom,
        bytes: new Uint8Array(buffer),
      });
    } else {
      this.indexingPrefetchByFilePath.delete(filePath);
    }
    const completeLines = splitJsonLines({
      text,
      previousPartialLine: cursor.partialLineBuffer,
      ignoreLeadingPartialLine,
    });
    const passiveFallbackTimestampMs = Math.trunc(fileStat.mtimeMs) || this.now();

    for (const line of completeLines.lines) {
      const before = this.instrumentationEnabled ? summarizeLiveSessionState(cursor.session) : null;
      cursor.session = liveHooks.applyTranscriptLine(
        cursor.session,
        line,
        passiveFallbackTimestampMs,
      );
      if (this.instrumentationEnabled) {
        const after = summarizeLiveSessionState(cursor.session);
        this.recordTrace({
          kind: "line_applied",
          source: liveHooks.transcriptTraceSource ?? `${discovered.provider}_transcript`,
          filePath,
          line: summarizeLiveLine(line),
          before,
          after,
          changed: !areInstrumentationValuesEqual(before, after),
        });
      }
    }

    if (readFrom !== previousOffset) {
      cursor.session.bestEffort = true;
    }
    cursor.offset = fileStat.size;
    cursor.lastSize = fileStat.size;
    cursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
    cursor.partialLineBuffer = completeLines.partialLineBuffer;
    this.invalidateSnapshotCache();
  }

  private async processClaudeHookLogFile(filePath: string): Promise<void> {
    const fileStat = await safeStat(filePath);
    if (!fileStat?.isFile()) {
      this.resetHookCursor();
      return;
    }

    let readFrom = this.hookCursor.offset;
    let ignoreLeadingPartialLine = false;
    if (fileStat.size < this.hookCursor.offset) {
      readFrom = Math.max(0, fileStat.size - INITIAL_TAIL_BYTES);
      ignoreLeadingPartialLine = readFrom > 0;
      this.hookCursor.partialLineBuffer = "";
    }

    if (fileStat.size <= readFrom) {
      this.hookCursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
      this.hookCursor.lastSize = fileStat.size;
      return;
    }
    while (readFrom < fileStat.size) {
      const nextLength = Math.min(fileStat.size - readFrom, MAX_READ_BYTES);
      const buffer = await readBufferRange(filePath, readFrom, nextLength);
      const completeLines = splitTopLevelJsonObjects({
        text: buffer.toString("utf8"),
        previousPartialLine: this.hookCursor.partialLineBuffer,
        ignoreLeadingPartialLine,
      });

      for (const line of completeLines.lines) {
        if (!this.discoveryConfig) {
          continue;
        }
        const eligibleProviders = this.getRecentLiveProviders().filter(
          (provider) => getProviderAdapter(provider).liveSession?.readHookTranscriptPath,
        );
        if (eligibleProviders.length === 0) {
          continue;
        }
        const transcriptMatch = eligibleProviders
          .map((provider) => ({
            provider,
            transcriptPath:
              getProviderAdapter(provider).liveSession?.readHookTranscriptPath?.(line) ?? null,
          }))
          .find((candidate) => candidate.transcriptPath);
        if (!transcriptMatch?.transcriptPath) {
          continue;
        }
        const discovered = discoverSingleFile(transcriptMatch.transcriptPath, this.discoveryConfig);
        const liveHooks = discovered ? getProviderAdapter(discovered.provider).liveSession : null;
        if (!discovered || !liveHooks?.applyHookLine) {
          continue;
        }
        const cursor = this.ensureCursor(discovered.filePath, discovered);
        const before = this.instrumentationEnabled
          ? summarizeLiveSessionState(cursor.session)
          : null;
        cursor.session = liveHooks.applyHookLine(cursor.session, line, this.now());
        if (this.instrumentationEnabled) {
          const after = summarizeLiveSessionState(cursor.session);
          this.recordTrace({
            kind: "line_applied",
            source: liveHooks.hookTraceSource ?? `${discovered.provider}_hook`,
            filePath,
            transcriptPath: transcriptMatch.transcriptPath,
            line: summarizeLiveLine(line),
            before,
            after,
            changed: !areInstrumentationValuesEqual(before, after),
          });
        }
      }

      readFrom += buffer.length;
      this.hookCursor.partialLineBuffer = completeLines.partialLineBuffer;
      ignoreLeadingPartialLine = false;
      if (buffer.length < nextLength) {
        break;
      }
    }

    this.hookCursor.offset = readFrom;
    this.hookCursor.lastSize = fileStat.size;
    this.hookCursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
    this.invalidateSnapshotCache();
  }

  private ensureCursor(
    filePath: string,
    discovered: NonNullable<ReturnType<typeof discoverSingleFile>>,
  ): FileCursorState {
    const current = this.sessionCursors.get(filePath);
    if (current) {
      current.session.projectName = discovered.projectName || null;
      current.session.projectPath = discovered.projectPath || null;
      current.session.cwd = discovered.metadata.cwd ?? current.session.cwd;
      return current;
    }

    const next: FileCursorState = {
      filePath,
      offset: 0,
      lastSize: 0,
      lastMtimeMs: 0,
      partialLineBuffer: "",
      session: createInitialLiveSessionState({
        provider: discovered.provider,
        filePath: discovered.filePath,
        sessionIdentity: discovered.sessionIdentity,
        sourceSessionId: discovered.sourceSessionId,
        projectName: discovered.projectName || null,
        projectPath: discovered.projectPath || null,
        cwd: discovered.metadata.cwd ?? null,
      }),
    };
    this.sessionCursors.set(filePath, next);
    if (this.instrumentationEnabled) {
      this.recordTrace({
        kind: "cursor_created",
        provider: discovered.provider,
        filePath,
        session: summarizeLiveSessionState(next.session),
      });
    }
    return next;
  }

  private inspectClaudeHookState(): ClaudeHookState {
    return inspectClaudeHookState({
      homeDir: this.homeDir,
      userDataDir: this.userDataDir,
    });
  }

  private async updateClaudeSettingsJson(
    settingsPath: string,
    updater: (settings: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return updateClaudeSettingsJson(settingsPath, updater);
  }

  private async stopHookWatcher(): Promise<void> {
    if (!this.hookWatcher) {
      return;
    }
    await this.hookWatcher.stop();
    this.hookWatcher = null;
    this.resetHookCursor();
  }

  private resetHookCursor(): void {
    this.hookCursor.offset = 0;
    this.hookCursor.lastSize = 0;
    this.hookCursor.lastMtimeMs = 0;
    this.hookCursor.partialLineBuffer = "";
  }

  private invalidateSnapshotCache(): void {
    this.snapshotDirty = true;
    this.snapshotCacheExpiresAtMs = 0;
    if (this.enabled && this.onSnapshotInvalidated) {
      this.onSnapshotInvalidated();
    }
  }

  private getClaudeSettingsPath(): string {
    return getClaudeSettingsPath(this.homeDir);
  }

  private getClaudeHookLogPath(): string {
    return getClaudeHookLogPath(this.userDataDir);
  }

  private clearStructuralInvalidation(): void {
    this.structuralInvalidationPending = false;
    this.structuralInvalidationObservedAtMs = null;
  }

  private reportBackgroundError(
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ): void {
    if (this.onBackgroundError) {
      this.onBackgroundError(message, error, details);
      return;
    }
    console.error(`[codetrail] ${message}`, error, details);
  }

  private recordTrace(record: Record<string, unknown>): void {
    if (!this.instrumentationEnabled) {
      return;
    }
    appendLiveInstrumentationRecord(this.liveTraceLogPath, {
      recordedAt: new Date(this.now()).toISOString(),
      ...record,
    });
  }
}

async function readBufferRange(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function splitJsonLines(input: {
  text: string;
  previousPartialLine: string;
  ignoreLeadingPartialLine: boolean;
}): {
  lines: string[];
  partialLineBuffer: string;
} {
  const combined = `${input.previousPartialLine}${input.text}`;
  const normalized = combined.replaceAll("\r\n", "\n");
  const parts = normalized.split("\n");
  const partialLineBuffer = normalized.endsWith("\n") ? "" : (parts.pop() ?? "");
  let lines = parts.map((line) => line.trim()).filter((line) => line.length > 0);
  if (input.ignoreLeadingPartialLine && !input.previousPartialLine) {
    lines = lines.slice(1);
  }
  return {
    lines,
    partialLineBuffer,
  };
}

function splitTopLevelJsonObjects(input: {
  text: string;
  previousPartialLine: string;
  ignoreLeadingPartialLine: boolean;
}): {
  lines: string[];
  partialLineBuffer: string;
} {
  const combined = `${input.previousPartialLine}${input.text}`.replaceAll("\r\n", "\n");
  const lines: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;
  let skippedLeadingObject =
    !input.ignoreLeadingPartialLine || input.previousPartialLine.length > 0;

  for (let index = 0; index < combined.length; index += 1) {
    const character = combined[index] ?? "";
    if (startIndex < 0) {
      if (character === "{") {
        startIndex = index;
        depth = 1;
        inString = false;
        escaping = false;
      }
      continue;
    }

    if (escaping) {
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = combined.slice(startIndex, index + 1);
        if (skippedLeadingObject) {
          lines.push(candidate);
        } else {
          skippedLeadingObject = true;
        }
        startIndex = -1;
      }
    }
  }

  let partialLineBuffer = startIndex >= 0 ? combined.slice(startIndex) : "";
  if (input.ignoreLeadingPartialLine && !input.previousPartialLine && lines.length === 0) {
    partialLineBuffer = "";
  }
  return {
    lines,
    partialLineBuffer,
  };
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
