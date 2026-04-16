import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { defaultTimestampNormalization, emptySourceMetadata, sortModels } from "../adapters/shared";
import { sanitizeCodexOversizedJsonlEvent } from "../oversized/codex";
import type { ProviderAdapter } from "../types";

import { discoverCodexFiles, discoverSingleCodexFile } from "./discovery";
import {
  annotateFlushedCodexPendingMessage,
  flushCodexPendingMessagesBeforeEvent,
  normalizeCodexProjectPaths,
  prepareCodexMessagesForPersistence,
  updateCodexTurnGroupingStateAfterEvent,
  updateCodexTurnGroupingStateBeforeEvent,
} from "./indexing";
import { applyCodexLiveLine } from "./live";
import { parseCodexEvent, parseCodexPayload } from "./parser";

export const codexAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.codex,
  sourceFormat: "jsonl_stream",
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverCodexFiles,
  discoverOne: discoverSingleCodexFile,
  sanitizeOversizedJsonlEvent: sanitizeCodexOversizedJsonlEvent,
  parsePayload: parseCodexPayload,
  parseEvent: parseCodexEvent,
  extractSourceMetadata: (payload) => {
    const models = new Set<string>();
    let gitBranch: string | null = null;
    let cwd: string | null = null;

    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      const payloadRecord = asRecord(record?.payload);
      const payloadGit = asRecord(payloadRecord?.git);
      const model = readString(payloadRecord?.model);
      if (model) {
        models.add(model);
      }
      cwd ??= readString(payloadRecord?.cwd);
      gitBranch ??= readString(payloadGit?.branch);
    }

    return {
      ...emptySourceMetadata(),
      models: sortModels(models),
      gitBranch,
      cwd,
    };
  },
  updateSourceMetadataFromEvent: (event, accumulator) => {
    const record = asRecord(event);
    if (!record) {
      return;
    }

    const payloadRecord = asRecord(record.payload);
    const payloadGit = asRecord(payloadRecord?.git);
    const model = readString(payloadRecord?.model);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.cwd ??= readString(payloadRecord?.cwd);
    accumulator.gitBranch ??= readString(payloadGit?.branch);
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
  normalizeProjectPaths: normalizeCodexProjectPaths,
  prepareMessagesForPersistence: ({ event, processingState, messages }) =>
    prepareCodexMessagesForPersistence({
      event,
      processingState,
      messages,
    }),
  updateTurnGroupingBeforeEvent: updateCodexTurnGroupingStateBeforeEvent,
  updateTurnGroupingAfterEvent: updateCodexTurnGroupingStateAfterEvent,
  flushPendingMessagesBeforeEvent: flushCodexPendingMessagesBeforeEvent,
  annotateFlushedPendingMessage: annotateFlushedCodexPendingMessage,
  liveSession: {
    applyTranscriptLine: applyCodexLiveLine,
    transcriptTraceSource: "codex_transcript",
  },
};
