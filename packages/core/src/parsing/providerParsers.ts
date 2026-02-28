import type {
  MessageCategory,
  OperationDurationConfidence,
  OperationDurationSource,
  Provider,
} from "../contracts/canonical";

import type { ParserDiagnostic } from "./contracts";
import {
  EPOCH_ISO,
  type TokenUsage,
  asArray,
  asRecord,
  extractEventTimestamp,
  extractEvents,
  extractText,
  extractTokenUsage,
  lowerString,
  readString,
  serializeUnknown,
} from "./helpers";

type EventSegment = {
  category: MessageCategory;
  content: string;
  operationDurationMs?: number | null;
  operationDurationSource?: OperationDurationSource | null;
  operationDurationConfidence?: OperationDurationConfidence | null;
};

export type ParsedProviderMessage = {
  id: string;
  createdAt: string;
  category: MessageCategory;
  content: string;
  tokenInput: number | null;
  tokenOutput: number | null;
  operationDurationMs: number | null;
  operationDurationSource: OperationDurationSource | null;
  operationDurationConfidence: OperationDurationConfidence | null;
};

export function parseProviderPayload(args: {
  provider: Provider;
  sessionId: string;
  payload: unknown;
  diagnostics: ParserDiagnostic[];
}): ParsedProviderMessage[] {
  const { provider } = args;

  if (provider === "claude") {
    return parseClaudePayload(args);
  }

  if (provider === "codex") {
    return parseCodexPayload(args);
  }

  return parseGeminiPayload(args);
}

function parseClaudePayload(args: {
  provider: Provider;
  sessionId: string;
  payload: unknown;
  diagnostics: ParserDiagnostic[];
}): ParsedProviderMessage[] {
  const { provider, sessionId, payload, diagnostics } = args;
  const events = extractEvents(payload);
  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, event] of events.entries()) {
    const eventRecord = asRecord(event);
    if (!eventRecord) {
      sequence = pushNonObjectEvent({
        output,
        provider,
        sessionId,
        eventIndex,
        event,
        diagnostics,
        sequence,
      });
      continue;
    }

    const messageRecord = asRecord(eventRecord.message);
    const normalized = messageRecord ?? eventRecord;
    const sourceType = lowerString(
      eventRecord.type ??
        normalized.role ??
        normalized.type ??
        normalized.author ??
        normalized.sender,
    );
    if (
      sourceType === "progress" ||
      sourceType === "file-history-snapshot" ||
      sourceType === "queue-operation"
    ) {
      continue;
    }

    const createdAt = firstKnownTimestamp(eventRecord, normalized);
    const usage = extractTokenUsage(messageRecord ?? eventRecord);
    const baseId =
      readString(eventRecord.uuid) ??
      readString(eventRecord.id) ??
      readString(normalized.id) ??
      null;
    const segments = dedupeSegments(parseClaudeSegments(sourceType, normalized));
    if (segments.length === 0) {
      diagnostics.push({
        severity: "warning",
        code: "parser.unknown_event_shape",
        provider,
        sessionId,
        eventIndex,
        message: "Event shape did not match known patterns; normalized to system message.",
      });
    }

    sequence = pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage: usage,
      segments,
      fallbackRaw: event,
    });
  }

  return output;
}

function parseCodexPayload(args: {
  provider: Provider;
  sessionId: string;
  payload: unknown;
  diagnostics: ParserDiagnostic[];
}): ParsedProviderMessage[] {
  const { provider, sessionId, payload, diagnostics } = args;
  const events = extractEvents(payload);
  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, event] of events.entries()) {
    const eventRecord = asRecord(event);
    if (!eventRecord) {
      sequence = pushNonObjectEvent({
        output,
        provider,
        sessionId,
        eventIndex,
        event,
        diagnostics,
        sequence,
      });
      continue;
    }

    const eventType = lowerString(eventRecord.type);
    const eventKind = lowerString(eventRecord.kind ?? eventRecord.event_type);
    if (!eventType && eventKind) {
      const segments = parseSyntheticCodexSegments(eventKind, eventRecord);
      if (segments.length === 0) {
        continue;
      }

      sequence = pushSplitMessages({
        output,
        sessionId,
        sequence,
        baseId: readString(eventRecord.id),
        createdAt: extractEventTimestamp(eventRecord),
        tokenUsage: extractTokenUsage(eventRecord),
        segments: dedupeSegments(segments),
        fallbackRaw: event,
      });
      continue;
    }

    if (eventType === "turn_context") {
      continue;
    }

    if (eventType !== "response_item") {
      continue;
    }

    const payloadRecord = asRecord(eventRecord.payload);
    if (!payloadRecord) {
      continue;
    }

    const payloadType = lowerString(payloadRecord.type);
    const createdAt = extractEventTimestamp(eventRecord);
    const tokenUsage = extractTokenUsage(payloadRecord);
    const callId = readString(payloadRecord.call_id);
    const baseId =
      readString(payloadRecord.id) ?? (callId && payloadType ? `${callId}:${payloadType}` : callId);
    const segments = parseCodexSegments(payloadType, payloadRecord, sessionId, sequence);
    if (segments.length === 0) {
      continue;
    }

    sequence = pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage,
      segments: dedupeSegments(segments),
      fallbackRaw: event,
    });
  }

  return output;
}

function parseGeminiPayload(args: {
  provider: Provider;
  sessionId: string;
  payload: unknown;
  diagnostics: ParserDiagnostic[];
}): ParsedProviderMessage[] {
  const { provider, sessionId, payload, diagnostics } = args;
  const events = extractGeminiEvents(payload);
  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, event] of events.entries()) {
    const eventRecord = asRecord(event);
    if (!eventRecord) {
      sequence = pushNonObjectEvent({
        output,
        provider,
        sessionId,
        eventIndex,
        event,
        diagnostics,
        sequence,
      });
      continue;
    }

    const messageType = lowerString(eventRecord.type);
    const role = lowerString(eventRecord.author ?? eventRecord.role ?? eventRecord.sender);
    const createdAt = extractEventTimestamp(eventRecord);
    const usage = extractTokenUsage(eventRecord);
    const baseId = readString(eventRecord.id);

    let segments: EventSegment[];
    if (messageType === "user" || (!messageType && role === "user")) {
      segments = parseGeminiUserSegments(eventRecord);
    } else if (
      messageType === "gemini" ||
      messageType === "assistant" ||
      messageType === "model" ||
      (!messageType && (role === "assistant" || role === "model"))
    ) {
      segments = parseGeminiAssistantSegments(eventRecord);
    } else if (messageType === "info" || messageType === "system" || messageType === "summary") {
      const text = extractPrimaryText(eventRecord);
      segments = text.length > 0 ? [{ category: "system", content: text }] : [];
    } else {
      segments = parseGeminiGenericSegments(eventRecord);
    }

    const normalizedSegments = dedupeSegments(segments);
    if (normalizedSegments.length === 0) {
      diagnostics.push({
        severity: "warning",
        code: "parser.unknown_event_shape",
        provider,
        sessionId,
        eventIndex,
        message: "Event shape did not match known patterns; normalized to system message.",
      });
    }

    sequence = pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage: usage,
      segments: normalizedSegments,
      fallbackRaw: event,
    });
  }

  return output;
}

function parseClaudeSegments(
  sourceType: string | null,
  event: Record<string, unknown>,
): EventSegment[] {
  const segments: EventSegment[] = [];
  const blocks = parseStructuredBlocks(event.content);
  const aggregateText = blocks
    .filter((block) => block.kind === "text" || block.kind === "thinking")
    .map((block) => block.content)
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();

  if (sourceType === "summary" || sourceType === "system" || sourceType === "info") {
    const text = aggregateText || readString(event.summary) || extractPrimaryText(event);
    if (text.length > 0) {
      segments.push({ category: "system", content: text });
    }
    return segments;
  }

  if (sourceType === "user") {
    for (const block of blocks) {
      if (block.kind === "tool_result") {
        segments.push({ category: "tool_result", content: block.content });
      } else if (block.kind === "text") {
        segments.push({ category: "user", content: block.content });
      }
    }

    if (segments.length === 0) {
      const fallback = aggregateText || extractPrimaryText(event);
      if (fallback.length > 0) {
        segments.push({ category: "user", content: fallback });
      }
    }

    return segments;
  }

  if (sourceType === "assistant" || sourceType === "model") {
    for (const block of blocks) {
      if (block.kind === "thinking") {
        segments.push({ category: "thinking", content: block.content });
      } else if (block.kind === "tool_use") {
        segments.push({ category: "tool_use", content: block.content });
      } else if (block.kind === "tool_result") {
        segments.push({ category: "tool_result", content: block.content });
      } else if (block.kind === "text") {
        segments.push({ category: "assistant", content: block.content });
      }
    }

    if (segments.length === 0) {
      const fallback = aggregateText || extractPrimaryText(event);
      if (fallback.length > 0) {
        segments.push({ category: "assistant", content: fallback });
      }
    }

    return segments;
  }

  const fallback = aggregateText || extractPrimaryText(event);
  if (fallback.length > 0) {
    segments.push({ category: "system", content: fallback });
  }
  return segments;
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

  if (payloadType === "function_call") {
    const toolName = readString(payloadRecord.name) ?? "tool";
    const callId = readString(payloadRecord.call_id) ?? `${sessionId}:tool:${sequence}`;
    const argsJson = safeJsonString(payloadRecord.arguments);
    const input = parseMaybeJson(argsJson);
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

  if (payloadType === "custom_tool_call") {
    const toolName = readString(payloadRecord.name) ?? "tool";
    const callId = readString(payloadRecord.call_id) ?? `${sessionId}:tool:${sequence}`;
    const input = parseMaybeJson(safeJsonString(payloadRecord.input));
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

  if (payloadType === "function_call_output") {
    const operationDurationMs = extractCodexNativeDurationMs(payloadRecord.output);
    const output = extractCodexFunctionOutput(payloadRecord.output);
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

  if (payloadType === "custom_tool_call_output") {
    const operationDurationMs = extractCodexNativeDurationMs(payloadRecord.output);
    const output = extractCodexFunctionOutput(payloadRecord.output);
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

  if (payloadType === "reasoning") {
    const thinking = extractCodexReasoning(payloadRecord);
    return thinking.length > 0 ? [{ category: "thinking", content: thinking }] : [];
  }

  return payloadType ? [{ category: "system", content: serializeUnknown(payloadRecord) }] : [];
}

function parseGeminiUserSegments(event: Record<string, unknown>): EventSegment[] {
  const segments: EventSegment[] = [];
  for (const block of parseGeminiBlocks(event)) {
    if (block.kind === "text") {
      segments.push({ category: "user", content: block.content });
    } else if (block.kind === "tool_result") {
      segments.push({ category: "tool_result", content: block.content });
    }
  }

  if (segments.length === 0) {
    const text = extractPrimaryText(event);
    if (text.length > 0) {
      segments.push({ category: "user", content: text });
    }
  }

  return segments;
}

function parseGeminiAssistantSegments(event: Record<string, unknown>): EventSegment[] {
  const segments: EventSegment[] = [];
  for (const thought of extractGeminiThoughts(event.thoughts)) {
    segments.push({ category: "thinking", content: thought });
  }

  for (const block of parseGeminiBlocks(event)) {
    if (block.kind === "thinking") {
      segments.push({ category: "thinking", content: block.content });
    } else if (block.kind === "tool_use") {
      segments.push({ category: "tool_use", content: block.content });
    } else if (block.kind === "tool_result") {
      segments.push({ category: "tool_result", content: block.content });
    } else if (block.kind === "text") {
      segments.push({ category: "assistant", content: block.content });
    }
  }

  if (segments.length === 0) {
    const text = extractPrimaryText(event);
    if (text.length > 0) {
      segments.push({ category: "assistant", content: text });
    }
  }

  return segments;
}

function parseGeminiGenericSegments(event: Record<string, unknown>): EventSegment[] {
  const segments = parseGeminiBlocks(event).map((block) => {
    if (block.kind === "thinking") {
      return { category: "thinking", content: block.content } as EventSegment;
    }
    if (block.kind === "tool_use") {
      return { category: "tool_use", content: block.content } as EventSegment;
    }
    if (block.kind === "tool_result") {
      return { category: "tool_result", content: block.content } as EventSegment;
    }
    return { category: "system", content: block.content } as EventSegment;
  });

  if (segments.length > 0) {
    return segments;
  }

  const text = extractPrimaryText(event);
  return text.length > 0 ? [{ category: "system", content: text }] : [];
}

type ParsedBlock = {
  kind: "text" | "thinking" | "tool_use" | "tool_result";
  content: string;
};

function parseGeminiBlocks(event: Record<string, unknown>): ParsedBlock[] {
  const parts = asArray(event.parts);
  if (parts.length > 0) {
    return parseStructuredBlocks(parts);
  }

  const contentRecord = asRecord(event.content);
  const nestedParts = asArray(contentRecord?.parts);
  if (nestedParts.length > 0) {
    return parseStructuredBlocks(nestedParts);
  }

  return parseStructuredBlocks(event.content);
}

function parseStructuredBlocks(content: unknown): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  const maybePushText = (value: unknown, kind: ParsedBlock["kind"] = "text"): void => {
    for (const text of extractText(value)) {
      if (text.length > 0) {
        blocks.push({ kind, content: text });
      }
    }
  };

  for (const block of asArray(content)) {
    if (typeof block === "string") {
      maybePushText(block, "text");
      continue;
    }

    const blockRecord = asRecord(block);
    if (!blockRecord) {
      maybePushText(block, "text");
      continue;
    }

    if ("functionCall" in blockRecord) {
      blocks.push({ kind: "tool_use", content: serializeUnknown(blockRecord.functionCall) });
      continue;
    }

    if ("functionResponse" in blockRecord) {
      blocks.push({ kind: "tool_result", content: serializeUnknown(blockRecord.functionResponse) });
      continue;
    }

    const blockType = lowerString(blockRecord.type);
    if (blockType === "thinking" || blockType === "reasoning") {
      maybePushText(blockRecord.thinking ?? blockRecord, "thinking");
      continue;
    }

    if (blockType === "tool_use" || blockType === "tool_call" || blockType === "tool-call") {
      blocks.push({ kind: "tool_use", content: serializeUnknown(blockRecord) });
      continue;
    }

    if (
      blockType === "tool_result" ||
      blockType === "tool-result" ||
      blockType === "tool_response" ||
      blockType === "tool-response" ||
      blockType === "toolresponse"
    ) {
      const text = extractPrimaryText(blockRecord.content ?? blockRecord);
      blocks.push({ kind: "tool_result", content: text || serializeUnknown(blockRecord) });
      continue;
    }

    maybePushText(blockRecord, "text");
  }

  if (blocks.length === 0 && typeof content === "string") {
    maybePushText(content, "text");
  }

  if (blocks.length === 0 && asRecord(content)) {
    maybePushText(content, "text");
  }

  return blocks;
}

function parseCodexContent(content: unknown): string[] {
  const result: string[] = [];
  if (typeof content === "string") {
    return [content];
  }

  for (const block of asArray(content)) {
    if (typeof block === "string") {
      result.push(block);
      continue;
    }

    const blockRecord = asRecord(block);
    if (!blockRecord) {
      continue;
    }

    const text = readString(blockRecord.text);
    if (!text) {
      continue;
    }

    result.push(text);
  }

  return result;
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

function extractGeminiThoughts(thoughts: unknown): string[] {
  if (typeof thoughts === "string") {
    return thoughts.length > 0 ? [thoughts] : [];
  }

  return asArray(thoughts).flatMap((value) => {
    if (typeof value === "string" && value.length > 0) {
      return [value];
    }
    return [];
  });
}

function pushSplitMessages(args: {
  output: ParsedProviderMessage[];
  sessionId: string;
  sequence: number;
  baseId: string | null;
  createdAt: string;
  tokenUsage: TokenUsage;
  segments: EventSegment[];
  fallbackRaw: unknown;
}): number {
  const { output, sessionId, sequence, baseId, createdAt, tokenUsage, fallbackRaw } = args;
  const segments: EventSegment[] =
    args.segments.length > 0
      ? args.segments
      : [{ category: "system", content: serializeUnknown(fallbackRaw) }];
  const canonicalBase = baseId ?? `${sessionId}:msg:${sequence}`;
  let nextSequence = sequence;

  for (const [index, segment] of segments.entries()) {
    const id = index === 0 ? canonicalBase : `${canonicalBase}#${index + 1}`;
    const category =
      segment.category === "tool_use" ? inferToolUseCategory(segment.content) : segment.category;
    output.push({
      id,
      createdAt,
      category,
      content: segment.content,
      tokenInput: index === 0 ? tokenUsage.input : null,
      tokenOutput: index === 0 ? tokenUsage.output : null,
      operationDurationMs: segment.operationDurationMs ?? null,
      operationDurationSource: segment.operationDurationSource ?? null,
      operationDurationConfidence: segment.operationDurationConfidence ?? null,
    });
    nextSequence += 1;
  }
  return nextSequence;
}

function pushNonObjectEvent(args: {
  output: ParsedProviderMessage[];
  provider: Provider;
  sessionId: string;
  eventIndex: number;
  event: unknown;
  diagnostics: ParserDiagnostic[];
  sequence: number;
}): number {
  const { output, provider, sessionId, eventIndex, event, diagnostics, sequence } = args;
  diagnostics.push({
    severity: "warning",
    code: "parser.non_object_event",
    provider,
    sessionId,
    eventIndex,
    message: "Encountered non-object event; normalized to system message.",
  });

  return pushSplitMessages({
    output,
    sessionId,
    sequence,
    baseId: null,
    createdAt: EPOCH_ISO,
    tokenUsage: { input: null, output: null },
    segments: [{ category: "system", content: serializeUnknown(event) }],
    fallbackRaw: event,
  });
}

function extractGeminiEvents(payload: unknown): unknown[] {
  const record = asRecord(payload);
  const messages = asArray(record?.messages);
  if (messages.length > 0) {
    return messages;
  }

  return extractEvents(payload);
}

function dedupeSegments(segments: EventSegment[]): EventSegment[] {
  const seen = new Set<string>();
  const deduped: EventSegment[] = [];

  for (const segment of segments) {
    if (segment.content.length === 0) {
      continue;
    }

    const key = `${segment.category}:${segment.content}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(segment);
  }

  return deduped;
}

function extractPrimaryText(value: unknown): string {
  return extractText(value).join("\n").trim();
}

function firstKnownTimestamp(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): string {
  const first = extractEventTimestamp(primary);
  if (first !== EPOCH_ISO) {
    return first;
  }

  return extractEventTimestamp(fallback);
}

function safeJsonString(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "{}";
  }

  if (value === null || value === undefined) {
    return "{}";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractCodexNativeDurationMs(value: unknown): number | null {
  const seconds = extractDurationSeconds(value);
  if (seconds === null) {
    return null;
  }

  return Math.trunc(seconds * 1000);
}

function extractDurationSeconds(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const numeric = parseNonNegativeNumber(trimmed);
    if (numeric !== null) {
      return numeric;
    }

    try {
      return extractDurationSeconds(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const seconds = extractDurationSeconds(item);
      if (seconds !== null) {
        return seconds;
      }
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const metadata = asRecord(record.metadata);
  const direct = [
    record.duration_seconds,
    record.durationSeconds,
    record.elapsed_seconds,
    record.elapsedSeconds,
    record.elapsed_time_seconds,
    metadata?.duration_seconds,
    metadata?.durationSeconds,
    metadata?.elapsed_seconds,
    metadata?.elapsedSeconds,
    metadata?.elapsed_time_seconds,
  ];

  for (const candidate of direct) {
    const parsed = parseNonNegativeNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  if ("output" in record) {
    const nested = extractDurationSeconds(record.output);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function inferToolUseCategory(content: string): MessageCategory {
  const parsed = parseMaybeJson(content);
  const record = asRecord(parsed);
  if (!record) {
    return looksLikeEditOperation(content) ? "tool_edit" : "tool_use";
  }

  const candidates: string[] = [];
  const pushValue = (value: unknown) => {
    const normalized = readString(value)?.trim().toLowerCase();
    if (normalized && normalized.length > 0) {
      candidates.push(normalized);
    }
  };

  pushValue(record.type);
  pushValue(record.name);
  pushValue(record.tool);
  pushValue(record.tool_name);
  pushValue(record.operation);

  const functionCall = asRecord(record.functionCall);
  if (functionCall) {
    pushValue(functionCall.name);
    pushValue(functionCall.tool_name);
    pushValue(functionCall.operation);
  }

  const input = asRecord(record.input);
  if (input) {
    pushValue(input.operation);
    pushValue(input.mode);
    pushValue(input.action);
    pushValue(input.tool);
  }

  const joined = candidates.join(" ");
  return looksLikeEditOperation(joined) ? "tool_edit" : "tool_use";
}

function looksLikeEditOperation(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const editHints = [
    "edit",
    "write",
    "rewrite",
    "replace",
    "apply_patch",
    "patch",
    "multi_edit",
    "create_file",
    "update_file",
    "delete_file",
    "insert",
    "str_replace",
  ];
  return editHints.some((hint) => normalized.includes(hint));
}
