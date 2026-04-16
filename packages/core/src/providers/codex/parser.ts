import {
  asArray,
  asRecord,
  extractEventTimestamp,
  extractEvents,
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
  dedupeSegments,
  extractCodexNativeDurationMs,
  extractPrimaryText,
  parseCodexContent,
  parseEventStreamPayload,
  parseMaybeJson,
  pushNonObjectEvent,
  pushSplitMessages,
  safeJsonString,
} from "../../parsing/providerParserShared";
import {
  extractCodetrailCompactedSnapshotText,
  isCodetrailCompactedSnapshotEvent,
} from "../oversized/codex";

export const parseCodexPayload = (args: ParseProviderPayloadArgs): ParsedProviderMessage[] =>
  parseEventStreamPayload(args, extractEvents, parseCodexEvent);

export function parseCodexEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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

  if (isCodetrailCompactedSnapshotEvent(eventRecord)) {
    const content = extractCodetrailCompactedSnapshotText(eventRecord);
    if (content.length === 0) {
      return { messages: output, nextSequence: sequence };
    }

    return {
      messages: output,
      nextSequence: pushSplitMessages({
        output,
        sessionId,
        sequence,
        baseId: null,
        createdAt: extractEventTimestamp(eventRecord),
        tokenUsage: { input: null, output: null },
        segments: [{ category: "system", content }],
        fallbackRaw: event,
      }),
    };
  }

  const eventType = lowerString(eventRecord.type);
  const eventKind = lowerString(eventRecord.kind ?? eventRecord.event_type);
  if (!eventType && eventKind) {
    const segments = parseSyntheticCodexSegments(eventKind, eventRecord);
    if (segments.length === 0) {
      return { messages: output, nextSequence: sequence };
    }

    return {
      messages: output,
      nextSequence: pushSplitMessages({
        output,
        sessionId,
        sequence,
        baseId: readString(eventRecord.id),
        createdAt: extractEventTimestamp(eventRecord),
        tokenUsage: extractTokenUsage(eventRecord),
        segments: dedupeSegments(segments),
        fallbackRaw: event,
      }),
    };
  }

  if (eventType === "turn_context" || eventType !== "response_item") {
    return { messages: output, nextSequence: sequence };
  }

  const payloadRecord = asRecord(eventRecord.payload);
  if (!payloadRecord) {
    return { messages: output, nextSequence: sequence };
  }

  const payloadType = lowerString(payloadRecord.type);
  const createdAt = extractEventTimestamp(eventRecord);
  const tokenUsage = extractTokenUsage(payloadRecord);
  const callId = readString(payloadRecord.call_id);
  const baseId =
    readString(payloadRecord.id) ?? (callId && payloadType ? `${callId}:${payloadType}` : callId);
  const segments = parseCodexSegments(payloadType, payloadRecord, sessionId, sequence);
  if (segments.length === 0) {
    return { messages: output, nextSequence: sequence };
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
      segments: dedupeSegments(segments),
      fallbackRaw: event,
    }),
  };
}

function parseCodexSegments(
  payloadType: string | null,
  payloadRecord: Record<string, unknown>,
  sessionId: string,
  sequence: number,
): EventSegment[] {
  if (payloadType === "message") {
    const role = lowerString(payloadRecord.role);
    if (role !== "user" && role !== "assistant") {
      return [];
    }

    const textParts = parseCodexContent(payloadRecord.content);
    if (textParts.length === 0) {
      return [];
    }

    if (role === "user") {
      return [{ category: "user", content: textParts.join("\n") }];
    }

    return textParts.map((text) => ({ category: "assistant", content: text }));
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    return buildCodexToolUseSegment(
      sessionId,
      sequence,
      payloadRecord,
      payloadType === "function_call" ? payloadRecord.arguments : payloadRecord.input,
    );
  }

  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
    return buildCodexToolResultSegment(payloadRecord.output);
  }

  if (payloadType === "reasoning") {
    const thinking = extractCodexReasoning(payloadRecord);
    return thinking.length > 0 ? [{ category: "thinking", content: thinking }] : [];
  }

  return payloadType ? [{ category: "system", content: serializeUnknown(payloadRecord) }] : [];
}

function parseSyntheticCodexSegments(
  eventKind: string,
  eventRecord: Record<string, unknown>,
): EventSegment[] {
  if (eventKind.includes("reasoning")) {
    const text = extractPrimaryText(eventRecord.message ?? eventRecord.text ?? eventRecord.content);
    return text.length > 0 ? [{ category: "thinking", content: text }] : [];
  }

  if (eventKind.includes("assistant")) {
    const text = extractPrimaryText(eventRecord.text ?? eventRecord.message ?? eventRecord.content);
    return text.length > 0 ? [{ category: "assistant", content: text }] : [];
  }

  if (eventKind.includes("user")) {
    const text = extractPrimaryText(eventRecord.text ?? eventRecord.message ?? eventRecord.content);
    return text.length > 0 ? [{ category: "user", content: text }] : [];
  }

  if (eventKind.includes("tool") && eventKind.includes("call")) {
    return [{ category: "tool_use", content: serializeUnknown(eventRecord) }];
  }

  if (
    eventKind.includes("tool") &&
    (eventKind.includes("result") || eventKind.includes("response"))
  ) {
    return [{ category: "tool_result", content: serializeUnknown(eventRecord) }];
  }

  return [];
}

function buildCodexToolUseSegment(
  sessionId: string,
  sequence: number,
  payloadRecord: Record<string, unknown>,
  rawInput: unknown,
): EventSegment[] {
  const toolName = readString(payloadRecord.name) ?? "tool";
  const callId = readString(payloadRecord.call_id) ?? `${sessionId}:tool:${sequence}`;
  const input = parseMaybeJson(safeJsonString(rawInput));
  return [
    {
      category: "tool_use",
      content: serializeUnknown({
        type: "tool_use",
        id: callId,
        name: toolName,
        input,
      }),
    },
  ];
}

function buildCodexToolResultSegment(rawOutput: unknown): EventSegment[] {
  const operationDurationMs = extractCodexNativeDurationMs(rawOutput);
  const output = extractCodexFunctionOutput(rawOutput);
  return output.length > 0
    ? [
        {
          category: "tool_result",
          content: output,
          operationDurationMs,
          operationDurationSource: operationDurationMs === null ? null : "native",
          operationDurationConfidence: operationDurationMs === null ? null : "high",
        },
      ]
    : [];
}

function extractCodexFunctionOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const output = readString(record.output);
  if (output) {
    return output;
  }

  return serializeUnknown(record);
}

function extractCodexReasoning(payload: Record<string, unknown>): string {
  const summary = asArray(payload.summary);
  const parts: string[] = [];
  for (const block of summary) {
    const blockRecord = asRecord(block);
    const text = readString(blockRecord?.text);
    if (text) {
      parts.push(text);
    }
  }

  if (parts.length > 0) {
    return parts.join("\n");
  }

  return readString(payload.content) ?? "";
}
