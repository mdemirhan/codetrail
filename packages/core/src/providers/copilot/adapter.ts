import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import {
  defaultTimestampNormalization,
  emptySourceMetadata,
  readMaterializedJsonSource,
  sortModels,
} from "../adapters/shared";
import type { ProviderAdapter } from "../types";

import { discoverCopilotFiles, discoverSingleCopilotFile } from "./discovery";
import { parseCopilotEvent, parseCopilotPayload } from "./parser";

export const copilotAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.copilot,
  sourceFormat: "materialized_json",
  supportsIncrementalCheckpoints: false,
  discoverAll: discoverCopilotFiles,
  discoverOne: discoverSingleCopilotFile,
  readSource: readMaterializedJsonSource,
  parsePayload: parseCopilotPayload,
  parseEvent: parseCopilotEvent,
  extractSourceMetadata: (payload) => {
    const root = asRecord(payload);
    const models = new Set<string>();
    for (const request of asArray(root?.requests)) {
      const record = asRecord(request);
      if (!record) {
        continue;
      }
      const model = readString(record.modelId);
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
