import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { defaultTimestampNormalization, sortModels } from "../adapters/shared";
import { sanitizeClaudeOversizedJsonlEvent } from "../oversized/claude";
import type { ProviderAdapter } from "../types";

import { discoverClaudeFiles, discoverSingleClaudeFile } from "./discovery";
import {
  annotateClaudeMessagesForEvent,
  createClaudeIndexingState,
  processClaudeIndexedEvent,
  registerClaudePersistedMessage,
  shouldSkipDuplicateClaudeEvent,
} from "./indexing";
import {
  applyClaudeHookLine,
  applyClaudeTranscriptLine,
  readClaudeHookTranscriptPath,
} from "./live";
import { parseClaudeEvent, parseClaudePayload } from "./parser";
import { resolveClaudeTurnFamilySessionIds } from "./query";

function extractClaudeSourceMetadata(payload: unknown[]) {
  const models = new Set<string>();
  let gitBranch: string | null = null;
  let cwd: string | null = null;

  for (const entry of asArray(payload)) {
    const record = asRecord(entry);
    const message = asRecord(record?.message);
    const model = readString(message?.model);
    if (model) {
      models.add(model);
    }

    gitBranch ??= readString(record?.gitBranch);
    cwd ??= readString(record?.cwd);
  }

  return {
    models: sortModels(models),
    gitBranch,
    cwd,
  };
}

export const claudeAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.claude,
  sourceFormat: "jsonl_stream",
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverClaudeFiles,
  discoverOne: discoverSingleClaudeFile,
  sanitizeOversizedJsonlEvent: sanitizeClaudeOversizedJsonlEvent,
  parsePayload: parseClaudePayload,
  parseEvent: parseClaudeEvent,
  extractSourceMetadata: (payload) => extractClaudeSourceMetadata(payload as unknown[]),
  updateSourceMetadataFromEvent: (event, accumulator) => {
    const record = asRecord(event);
    if (!record) {
      return;
    }

    const message = asRecord(record.message);
    const model = readString(message?.model);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.gitBranch ??= readString(record.gitBranch);
    accumulator.cwd ??= readString(record.cwd);
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
  createIndexingState: createClaudeIndexingState,
  prepareMessagesForPersistence: ({ eventRecord, processingState, messages }) => ({
    immediateMessages: annotateClaudeMessagesForEvent({
      eventRecord,
      processingState,
      messages,
    }),
    deferredCodexUserMessages: [],
  }),
  processIndexedEvent: processClaudeIndexedEvent,
  registerPersistedMessage: registerClaudePersistedMessage,
  shouldSkipDuplicateEvent: shouldSkipDuplicateClaudeEvent,
  resolveTurnFamilySessionIds: resolveClaudeTurnFamilySessionIds,
  handlesToolEditsNatively: true,
  liveSession: {
    applyTranscriptLine: applyClaudeTranscriptLine,
    applyHookLine: applyClaudeHookLine,
    readHookTranscriptPath: readClaudeHookTranscriptPath,
    transcriptTraceSource: "claude_transcript",
    hookTraceSource: "claude_hook",
  },
};
