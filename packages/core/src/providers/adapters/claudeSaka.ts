import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { discoverClaudeSakaFiles, discoverSingleClaudeSakaFile } from "../../discovery/providers/claudeSaka";
import { asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";
import { sanitizeClaudeOversizedJsonlEvent } from "../oversized/claude";

import type { ProviderAdapter } from "../types";
import { defaultTimestampNormalization, sortModels } from "./shared";

function extractClaudeSakaSourceMetadata(payload: unknown[]) {
  const models = new Set<string>();
  let gitBranch: string | null = null;
  let cwd: string | null = null;

  for (const entry of Array.isArray(payload) ? payload : []) {
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

export const claudeSakaAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA["claude-saka"],
  sourceFormat: "jsonl_stream",
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverClaudeSakaFiles,
  discoverOne: discoverSingleClaudeSakaFile,
  sanitizeOversizedJsonlEvent: sanitizeClaudeOversizedJsonlEvent,
  parsePayload: PROVIDER_PAYLOAD_PARSERS["claude-saka"],
  parseEvent: PROVIDER_EVENT_PARSERS["claude-saka"],
  extractSourceMetadata: (payload) => extractClaudeSakaSourceMetadata(payload as unknown[]),
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
};
