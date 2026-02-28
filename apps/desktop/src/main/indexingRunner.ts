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

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async enqueue(request: RefreshJobRequest): Promise<RefreshJobResponse> {
    const jobId = `refresh-${++this.sequence}`;
    const task = this.queue.then(async () => {
      runIncrementalIndexing({
        dbPath: this.dbPath,
        forceReindex: request.force,
      });
    });

    this.queue = task.catch(() => undefined);
    await task;

    return { jobId };
  }
}
