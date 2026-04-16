import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { defaultTimestampNormalization, emptySourceMetadata, sortModels } from "../adapters/shared";
import type { ProviderAdapter } from "../types";

import {
  discoverChangedOpenCodeFiles,
  discoverOpenCodeFiles,
  discoverSingleOpenCodeFile,
  readOpenCodeSource,
} from "./discovery";
import { cleanupMissingOpenCodeSessions } from "./indexing";
import { parseOpenCodeEvent, parseOpenCodePayload } from "./parser";

export const opencodeAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.opencode,
  sourceFormat: "materialized_json",
  supportsIncrementalCheckpoints: false,
  discoverAll: discoverOpenCodeFiles,
  discoverOne: discoverSingleOpenCodeFile,
  discoverChanged: discoverChangedOpenCodeFiles,
  readSource: readOpenCodeSource,
  parsePayload: parseOpenCodePayload,
  parseEvent: parseOpenCodeEvent,
  extractSourceMetadata: (payload) => {
    const root = asRecord(payload);
    const session = asRecord(root?.session);
    const models = new Set<string>();
    const cwd = readString(session?.directory);

    for (const entry of asArray(root?.messages)) {
      const record = asRecord(entry);
      const data = asRecord(record?.data);
      const nestedModel = asRecord(data?.model);
      const model = readString(data?.modelID) ?? readString(nestedModel?.modelID);
      if (model) {
        models.add(model);
      }
    }

    return {
      ...emptySourceMetadata(),
      models: sortModels(models),
      cwd,
    };
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
  cleanupMissingSessions: cleanupMissingOpenCodeSessions,
};
