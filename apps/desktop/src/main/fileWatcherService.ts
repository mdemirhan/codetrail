import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import * as watcher from "@parcel/watcher";

const WATCHED_EXTENSIONS = [".jsonl", ".json"];
const DEFAULT_DEBOUNCE_MS = 5000;

type SubscribeBackend = watcher.Options["backend"] | "kqueue";
type SubscribeOptions = Omit<watcher.Options, "backend"> & {
  backend?: SubscribeBackend;
};
type SubscribeFn = (
  root: string,
  callback: watcher.SubscribeCallback,
  options?: SubscribeOptions,
) => Promise<watcher.AsyncSubscription>;
export type FileWatcherOptions = {
  debounceMs?: number;
  onError?: (error: unknown) => void;
  subscribe?: SubscribeFn;
  subscribeOptions?: SubscribeOptions;
};

export type FileWatcherStatus = {
  running: boolean;
  processing: boolean;
  pendingPathCount: number;
};

export type FileWatcherBatch = {
  changedPaths: string[];
  requiresFullScan: boolean;
};

export class FileWatcherService {
  private readonly roots: string[];
  private readonly onFilesChanged: (batch: FileWatcherBatch) => void | Promise<void>;
  private readonly debounceMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly subscribeFn: SubscribeFn;
  private readonly subscribeOptions: SubscribeOptions;

  private subscriptions: watcher.AsyncSubscription[] = [];
  private watchedRoots: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths = new Set<string>();
  private pendingStructureChange = false;
  private processing = false;
  private flushPromise: Promise<void> | null = null;
  private stopped = false;
  private running = false;

  constructor(
    roots: string[],
    onFilesChanged: (batch: FileWatcherBatch) => void | Promise<void>,
    options: FileWatcherOptions = {},
  ) {
    this.roots = roots;
    this.onFilesChanged = onFilesChanged;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onError =
      options.onError ?? ((error) => console.error("FileWatcherService error:", error));
    this.subscribeFn = options.subscribe ?? (watcher.subscribe as SubscribeFn);
    this.subscribeOptions = options.subscribeOptions ?? {};
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.stopped = false;
    this.watchedRoots = [];

    for (const root of this.roots) {
      if (!existsSync(root)) {
        continue;
      }

      try {
        const watchedRoot = resolve(root);
        const subscription = await this.subscribeFn(
          watchedRoot,
          (err, events) => {
            if (err) {
              this.onError(err);
              return;
            }

            for (const event of events) {
              const eventPath = resolve(event.path);
              const isTrackedFile = WATCHED_EXTENSIONS.some((ext) => eventPath.endsWith(ext));
              if (isTrackedFile) {
                this.pendingPaths.add(eventPath);
                continue;
              }
              if (event.type !== "update" || isDirectoryPath(eventPath)) {
                this.pendingStructureChange = true;
              }
            }

            if (this.pendingPaths.size > 0 || this.pendingStructureChange) {
              this.scheduleDebouncedFlush();
            }
          },
          this.subscribeOptions,
        );

        // Guard against stop() having been called while subscribeFn was awaited
        if (this.stopped) {
          await subscription.unsubscribe();
        } else {
          this.subscriptions.push(subscription);
          this.watchedRoots.push(watchedRoot);
        }
      } catch (error) {
        this.onError(error);
      }
    }

    if (this.subscriptions.length === 0) {
      this.running = false;
      this.watchedRoots = [];
      throw new Error("No watcher subscriptions were established");
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.stopped = true;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingPaths.clear();
    this.pendingStructureChange = false;

    // Await any in-flight flush before unsubscribing
    if (this.flushPromise) {
      await this.flushPromise;
    }

    for (const subscription of this.subscriptions) {
      await subscription.unsubscribe();
    }

    this.subscriptions = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  getWatchedRoots(): string[] {
    return [...this.watchedRoots];
  }

  getStatus(): FileWatcherStatus {
    return {
      running: this.running,
      processing: this.processing,
      pendingPathCount: this.pendingPaths.size,
    };
  }

  private scheduleDebouncedFlush(): void {
    if (this.debounceTimer !== null) {
      return; // Timer already pending — new paths just accumulate in the set
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushPromise = this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (
      this.stopped ||
      this.processing ||
      (this.pendingPaths.size === 0 && !this.pendingStructureChange)
    ) {
      return;
    }

    this.processing = true;
    const batch = [...this.pendingPaths];
    const requiresFullScan = this.pendingStructureChange;
    this.pendingPaths.clear();
    this.pendingStructureChange = false;

    try {
      await this.onFilesChanged({
        changedPaths: batch,
        requiresFullScan,
      });
    } catch (error) {
      this.onError(error);
    } finally {
      this.processing = false;
      this.flushPromise = null;
      // If new paths accumulated during processing, flush again
      if (!this.stopped && (this.pendingPaths.size > 0 || this.pendingStructureChange)) {
        this.flushPromise = this.flush();
      }
    }
  }
}

function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
