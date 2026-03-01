import { parentPort } from "node:worker_threads";

import { type SystemMessageRegexRuleOverrides, runIncrementalIndexing } from "@codetrail/core";

type IndexingWorkerRequest = {
  dbPath: string;
  forceReindex: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
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
      ...(request.systemMessageRegexRules
        ? { systemMessageRegexRules: request.systemMessageRegexRules }
        : {}),
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
