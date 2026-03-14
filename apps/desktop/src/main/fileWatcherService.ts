import { existsSync } from "node:fs";

import * as watcher from "@parcel/watcher";

const WATCHED_EXTENSIONS = [".jsonl", ".json"];
const DEFAULT_DEBOUNCE_MS = 5000;

type SubscribeFn = typeof watcher.subscribe;

export type FileWatcherOptions = {
  debounceMs?: number;
  onError?: (error: unknown) => void;
  subscribe?: SubscribeFn;
};

export class FileWatcherService {
  private readonly roots: string[];
  private readonly onFilesChanged: (changedPaths: string[]) => void | Promise<void>;
  private readonly debounceMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly subscribeFn: SubscribeFn;

  private subscriptions: watcher.AsyncSubscription[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths = new Set<string>();
  private processing = false;
  private flushPromise: Promise<void> | null = null;
  private stopped = false;
  private running = false;

  constructor(
    roots: string[],
    onFilesChanged: (changedPaths: string[]) => void | Promise<void>,
    options: FileWatcherOptions = {},
  ) {
    this.roots = roots;
    this.onFilesChanged = onFilesChanged;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onError = options.onError ?? ((error) => console.error("FileWatcherService error:", error));
    this.subscribeFn = options.subscribe ?? watcher.subscribe;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.stopped = false;

    for (const root of this.roots) {
      if (!existsSync(root)) {
        continue;
      }

      try {
        const subscription = await this.subscribeFn(root, (err, events) => {
          if (err) {
            this.onError(err);
            return;
          }

          for (const event of events) {
            if (WATCHED_EXTENSIONS.some((ext) => event.path.endsWith(ext))) {
              this.pendingPaths.add(event.path);
            }
          }

          if (this.pendingPaths.size > 0) {
            this.scheduleDebouncedFlush();
          }
        });

        // Guard against stop() having been called while subscribeFn was awaited
        if (this.stopped) {
          await subscription.unsubscribe();
        } else {
          this.subscriptions.push(subscription);
        }
      } catch (error) {
        this.onError(error);
      }
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
    if (this.stopped || this.processing || this.pendingPaths.size === 0) {
      return;
    }

    this.processing = true;
    const batch = [...this.pendingPaths];
    this.pendingPaths.clear();

    try {
      await this.onFilesChanged(batch);
    } catch (error) {
      this.onError(error);
    } finally {
      this.processing = false;
      this.flushPromise = null;
      // If new paths accumulated during processing, flush again
      if (!this.stopped && this.pendingPaths.size > 0) {
        this.flushPromise = this.flush();
      }
    }
  }
}
