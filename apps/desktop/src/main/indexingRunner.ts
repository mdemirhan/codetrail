import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { runIncrementalIndexing } from "@codetrail/core";

export type RefreshJobRequest = {
  force: boolean;
};

export type RefreshJobResponse = {
  jobId: string;
};

export class WorkerIndexingRunner {
  private sequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly dbPath: string;
  private readonly workerUrl: URL | null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.workerUrl = resolveIndexingWorkerUrl();
  }

  async enqueue(request: RefreshJobRequest): Promise<RefreshJobResponse> {
    const jobId = `refresh-${++this.sequence}`;
    const task = this.queue.then(async () => {
      await runIndexingJob({
        dbPath: this.dbPath,
        forceReindex: request.force,
        workerUrl: this.workerUrl,
      });
    });

    this.queue = task.catch(() => undefined);
    await task;

    return { jobId };
  }
}

type IndexingWorkerRequest = {
  dbPath: string;
  forceReindex: boolean;
};

type IndexingWorkerResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

async function runIndexingJob(args: {
  dbPath: string;
  forceReindex: boolean;
  workerUrl: URL | null;
}): Promise<void> {
  if (!args.workerUrl) {
    runIncrementalIndexing({
      dbPath: args.dbPath,
      forceReindex: args.forceReindex,
    });
    return;
  }

  try {
    await runIndexingInWorker(args.workerUrl, {
      dbPath: args.dbPath,
      forceReindex: args.forceReindex,
    });
  } catch {
    runIncrementalIndexing({
      dbPath: args.dbPath,
      forceReindex: args.forceReindex,
    });
  }
}

function runIndexingInWorker(workerUrl: URL, request: IndexingWorkerRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      void worker.terminate();
      callback();
    };

    worker.once("message", (response: IndexingWorkerResponse) => {
      if (!response || response.ok !== true) {
        finish(() =>
          reject(new Error(response?.message ?? "Worker returned an invalid indexing response.")),
        );
        return;
      }
      finish(resolve);
    });

    worker.once("error", (error) => {
      finish(() => reject(error));
    });

    worker.once("exit", (code) => {
      if (settled || code === 0) {
        return;
      }
      finish(() => reject(new Error(`Indexing worker exited with code ${code}.`)));
    });

    worker.postMessage(request);
  });
}

function resolveIndexingWorkerUrl(): URL | null {
  const candidates = [new URL("./indexingWorker.js", import.meta.url)];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }
  return null;
}
