import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import {
  defaultTimestampNormalization,
  emptySourceMetadata,
  readMaterializedJsonSource,
  sortModels,
} from "../adapters/shared";
import type { ProviderAdapter } from "../types";

import { discoverGeminiFiles, discoverSingleGeminiFile } from "./discovery";
import { parseGeminiEvent, parseGeminiPayload } from "./parser";

export const geminiAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.gemini,
  sourceFormat: "materialized_json",
  supportsIncrementalCheckpoints: false,
  discoverAll: discoverGeminiFiles,
  discoverOne: discoverSingleGeminiFile,
  readSource: readMaterializedJsonSource,
  parsePayload: parseGeminiPayload,
  parseEvent: parseGeminiEvent,
  extractSourceMetadata: (payload) => {
    const root = asRecord(payload);
    const models = new Set<string>();
    for (const message of asArray(root?.messages)) {
      const record = asRecord(message);
      if (!record) {
        continue;
      }
      const model = readString(record.model);
      if (model) {
        models.add(model);
      }
    }

    return {
      ...emptySourceMetadata(),
      models: sortModels(models),
    };
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
};
