import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import {
  discoverCopilotCliFiles,
  discoverSingleCopilotCliFile,
} from "../../discovery/providers/copilotCli";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";

import type { ProviderAdapter } from "../types";
import { defaultTimestampNormalization, emptySourceMetadata, sortModels } from "./shared";

export const copilotCliAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.copilot_cli,
  sourceFormat: "jsonl_stream",
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverCopilotCliFiles,
  discoverOne: discoverSingleCopilotCliFile,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.copilot_cli,
  parseEvent: PROVIDER_EVENT_PARSERS.copilot_cli,
  extractSourceMetadata: (payload) => {
    const models = new Set<string>();
    let gitBranch: string | null = null;
    let cwd: string | null = null;

    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }

      const eventType = readString(record.type);
      const data = asRecord(record.data);

      if (eventType === "session.start") {
        const context = asRecord(data?.context);
        cwd ??= readString(context?.cwd);
        gitBranch ??= readString(context?.branch);
      }

      if (eventType === "tool.execution_complete") {
        const model = readString(data?.model);
        if (model) {
          models.add(model);
        }
      }
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

    const eventType = readString(record.type);
    const data = asRecord(record.data);

    if (eventType === "session.start") {
      const context = asRecord(data?.context);
      accumulator.cwd ??= readString(context?.cwd);
      accumulator.gitBranch ??= readString(context?.branch);
    }

    if (eventType === "tool.execution_complete") {
      const model = readString(data?.model);
      if (model) {
        accumulator.models.add(model);
      }
    }
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
};
