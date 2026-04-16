import {
  EPOCH_ISO,
  asArray,
  asRecord,
  extractTokenUsage,
  lowerString,
  readString,
  serializeUnknown,
} from "../../parsing/helpers";
import {
  type EventSegment,
  type ParseProviderEventArgs,
  type ParseProviderEventResult,
  type ParseProviderPayloadArgs,
  type ParsedProviderMessage,
  extractPrimaryText,
  inferToolUseCategory,
  nativeDurationSegment,
  pushNonObjectEvent,
  pushSplitMessages,
} from "../../parsing/providerParserShared";

export function parseOpenCodePayload(args: ParseProviderPayloadArgs): ParsedProviderMessage[] {
  const root = asRecord(args.payload);
  const messages = asArray(root?.messages);
  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, event] of messages.entries()) {
    const result = parseOpenCodeEvent({
      provider: args.provider,
      sessionId: args.sessionId,
      eventIndex,
      event,
      diagnostics: args.diagnostics,
      sequence,
    });
    output.push(...result.messages);
    sequence = result.nextSequence;
  }

  return output;
}

export function parseOpenCodeEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
  const { provider, sessionId, eventIndex, event, diagnostics, sequence } = args;
  const output: ParsedProviderMessage[] = [];
  const eventRecord = asRecord(event);
  if (!eventRecord) {
    return {
      messages: output,
      nextSequence: pushNonObjectEvent({
        output,
        provider,
        sessionId,
        eventIndex,
        event,
        diagnostics,
        sequence,
      }),
    };
  }

  const messageData = asRecord(eventRecord.data);
  if (!messageData) {
    return { messages: output, nextSequence: sequence };
  }

  const role = lowerString(messageData.role);
  const createdAt = extractOpenCodeCreatedAt(eventRecord, messageData);
  const baseId = readString(eventRecord.id) ?? readString(messageData.id) ?? null;
  const tokenUsage = extractTokenUsage(messageData);
  const segments: EventSegment[] = [];

  for (const part of asArray(eventRecord.parts)) {
    const partRecord = asRecord(part);
    const partData = asRecord(partRecord?.data) ?? partRecord;
    if (!partData) {
      continue;
    }

    const partType = lowerString(partData.type);
    if (partType === "step-start" || partType === "step-finish") {
      continue;
    }

    if (partType === "text") {
      const text = readString(partData.text);
      if (text) {
        segments.push({
          category: role === "assistant" ? "assistant" : role === "user" ? "user" : "system",
          content: text,
        });
      }
      continue;
    }

    if (partType === "reasoning") {
      const text = readString(partData.text);
      if (text) {
        segments.push({
          category: "thinking",
          content: text,
          ...nativeDurationSegment(extractOpenCodePartDurationMs(partData)),
        });
      }
      continue;
    }

    if (partType !== "tool") {
      continue;
    }

    const toolContent = buildOpenCodeToolUseContent(partData);
    segments.push({
      category: inferToolUseCategory(toolContent),
      content: toolContent,
      ...nativeDurationSegment(extractOpenCodeToolDurationMs(partData)),
    });

    const resultContent = extractOpenCodeToolResultContent(partData);
    if (resultContent) {
      segments.push({
        category: "tool_result",
        content: resultContent,
        ...nativeDurationSegment(extractOpenCodeToolDurationMs(partData)),
      });
    }
  }

  if (segments.length === 0) {
    const fallback = extractPrimaryText(messageData.summary);
    if (fallback.length > 0) {
      segments.push({
        category: role === "assistant" ? "assistant" : role === "user" ? "user" : "system",
        content: fallback,
      });
    }
  }

  const messageDurationMs = extractOpenCodeMessageDurationMs(messageData);
  if (messageDurationMs !== null) {
    const segment = segments.find((candidate) => candidate.category !== "thinking");
    if (segment && segment.operationDurationMs === undefined) {
      Object.assign(segment, nativeDurationSegment(messageDurationMs));
    }
  }

  return {
    messages: output,
    nextSequence: pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage,
      segments,
      fallbackRaw: event,
    }),
  };
}

function extractOpenCodeCreatedAt(
  eventRecord: Record<string, unknown>,
  messageData: Record<string, unknown>,
): string {
  const time = asRecord(messageData.time);
  return (
    toIsoTimestamp(time?.created) ??
    toIsoTimestamp(eventRecord.timeCreated) ??
    readString(messageData.timestamp) ??
    EPOCH_ISO
  );
}

function extractOpenCodeMessageDurationMs(messageData: Record<string, unknown>): number | null {
  const time = asRecord(messageData.time);
  const createdAt = numericTimestampMs(time?.created);
  const completedAt = numericTimestampMs(time?.completed);
  if (createdAt === null || completedAt === null || completedAt <= createdAt) {
    return null;
  }
  return completedAt - createdAt;
}

function extractOpenCodePartDurationMs(partData: Record<string, unknown>): number | null {
  return extractOpenCodeDurationFromTime(asRecord(partData.time));
}

function extractOpenCodeToolDurationMs(partData: Record<string, unknown>): number | null {
  return extractOpenCodeDurationFromTime(asRecord(asRecord(partData.state)?.time));
}

function extractOpenCodeDurationFromTime(time: Record<string, unknown> | null): number | null {
  const start = numericTimestampMs(time?.start);
  const end = numericTimestampMs(time?.end);
  if (start === null || end === null || end <= start) {
    return null;
  }
  return end - start;
}

function numericTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value > 1_000_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed > 1_000_000_000_000 ? Math.trunc(parsed) : Math.trunc(parsed * 1000);
    }
  }
  return null;
}

function toIsoTimestamp(value: unknown): string | null {
  const timestampMs = numericTimestampMs(value);
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

function buildOpenCodeToolUseContent(partData: Record<string, unknown>): string {
  const state = asRecord(partData.state);
  const toolName = readString(partData.tool) ?? "tool";
  const operation = toolName === "write" ? "write_file" : toolName === "edit" ? "edit" : toolName;
  const result = state?.error ?? state?.output ?? null;
  return serializeUnknown({
    type: "tool_use",
    id: readString(partData.callID) ?? null,
    name: toolName,
    operation,
    input: asRecord(state?.input) ?? {},
    result,
    output: result,
  });
}

function extractOpenCodeToolResultContent(partData: Record<string, unknown>): string | null {
  const state = asRecord(partData.state);
  if (!state) {
    return null;
  }

  const error = readString(state.error);
  if (error) {
    return error;
  }
  if (typeof state.output === "string" && state.output.trim().length > 0) {
    return state.output;
  }
  if (state.output !== undefined && state.output !== null) {
    return serializeUnknown(state.output);
  }
  return null;
}
