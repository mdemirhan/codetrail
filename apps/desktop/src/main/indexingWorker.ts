import { parentPort } from "node:worker_threads";

import { runIncrementalIndexing } from "@codetrail/core";

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

if (!parentPort) {
  throw new Error("Indexing worker started without a parent port.");
}

parentPort.on("message", (request: IndexingWorkerRequest) => {
  try {
    runIncrementalIndexing({
      dbPath: request.dbPath,
      forceReindex: request.forceReindex,
    });
    const response: IndexingWorkerResponse = { ok: true };
    parentPort?.postMessage(response);
  } catch (error) {
    const response: IndexingWorkerResponse = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
    parentPort?.postMessage(response);
  }
});
