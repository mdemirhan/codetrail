import { parentPort } from "node:worker_threads";

import {
  type IndexingFileIssue,
  type IndexingNotice,
  type SystemMessageRegexRuleOverrides,
  indexChangedFiles,
  runIncrementalIndexing,
} from "@codetrail/core";

import { initializeOpenCodeReaders } from "./openCodeReaders";

type IncrementalRequest = {
  kind: "incremental";
  dbPath: string;
  forceReindex: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
};

type ChangedFilesRequest = {
  kind: "changedFiles";
  dbPath: string;
  changedFilePaths: string[];
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
};

type IndexingWorkerRequest = IncrementalRequest | ChangedFilesRequest;

type IndexingWorkerResult =
  | {
      type: "result";
      ok: true;
    }
  | {
      type: "result";
      ok: false;
      message: string;
      stack?: string;
    };

type IndexingWorkerMessage =
  | IndexingWorkerResult
  | {
      type: "file-issue";
      issue: Omit<IndexingFileIssue, "error"> & {
        error: unknown;
      };
    }
  | {
      type: "notice";
      notice: IndexingNotice;
    };

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return error;
}

function postMessage(message: IndexingWorkerMessage): void {
  if (parentPort) {
    parentPort.postMessage(message);
    return;
  }
  if (typeof process.send === "function") {
    process.send(message);
    return;
  }
  throw new Error("Indexing worker started without a parent communication channel.");
}

function makeDependencies() {
  return {
    onFileIssue: (issue: IndexingFileIssue) => {
      postMessage({
        type: "file-issue",
        issue: {
          ...issue,
          error: serializeError(issue.error),
        },
      });
    },
    onNotice: (notice: IndexingNotice) => {
      postMessage({
        type: "notice",
        notice,
      });
    },
  };
}

function handleRequest(request: IndexingWorkerRequest): void {
  try {
    if (request.kind === "changedFiles") {
      indexChangedFiles(
        {
          dbPath: request.dbPath,
          ...(request.systemMessageRegexRules
            ? { systemMessageRegexRules: request.systemMessageRegexRules }
            : {}),
        },
        request.changedFilePaths,
        makeDependencies(),
      );
    } else {
      runIncrementalIndexing(
        {
          dbPath: request.dbPath,
          forceReindex: request.forceReindex,
          ...(request.systemMessageRegexRules
            ? { systemMessageRegexRules: request.systemMessageRegexRules }
            : {}),
        },
        makeDependencies(),
      );
    }
    postMessage({ type: "result", ok: true });
  } catch (error) {
    postMessage({
      type: "result",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
  }
}

initializeOpenCodeReaders();

if (parentPort) {
  parentPort.on("message", (request: IndexingWorkerRequest) => {
    handleRequest(request);
  });
} else if (typeof process.send === "function") {
  process.on("message", (request: IndexingWorkerRequest) => {
    handleRequest(request);
  });
} else {
  throw new Error("Indexing worker started without a parent communication channel.");
}
