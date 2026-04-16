import { createHash } from "node:crypto";

import type {
  MessageCategory,
  OperationDurationConfidence,
  OperationDurationSource,
  Provider,
  TurnAnchorKind,
  TurnGroupingMode,
} from "../contracts/canonical";
import { isLikelyEditOperation } from "../tooling/editOperations";

import type { ParserDiagnostic } from "./contracts";
import {
  EPOCH_ISO,
  type TokenUsage,
  asArray,
  asRecord,
  extractEventTimestamp,
  extractEvents,
  extractText,
  lowerString,
  readString,
  serializeUnknown,
} from "./helpers";

export type EventSegment = {
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
  turnGroupId?: string | null;
  turnGroupingMode?: TurnGroupingMode | null;
  turnAnchorKind?: TurnAnchorKind | null;
  nativeTurnId?: string | null;
};

export type ParseProviderPayloadArgs = {
  provider: Provider;
  sessionId: string;
  payload: unknown;
  diagnostics: ParserDiagnostic[];
};

export type ParseProviderEventArgs = {
  provider: Provider;
  sessionId: string;
  eventIndex: number;
  event: unknown;
  diagnostics: ParserDiagnostic[];
  sequence: number;
};

export type ParseProviderEventResult = {
  messages: ParsedProviderMessage[];
  nextSequence: number;
};

export type ParsedBlock = {
  kind: "text" | "thinking" | "tool_use" | "tool_result";
  content: string;
};

export function parseEventStreamPayload(
  args: ParseProviderPayloadArgs,
  eventExtractor: (payload: unknown) => unknown[],
  eventParser: (args: ParseProviderEventArgs) => ParseProviderEventResult,
): ParsedProviderMessage[] {
  const events = eventExtractor(args.payload);
  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, event] of events.entries()) {
    const result = eventParser({
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

export function parseStructuredBlocks(content: unknown): ParsedBlock[] {
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

export function parseCodexContent(content: unknown): string[] {
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

export function nativeDurationSegment(durationMs: number | null): {
  operationDurationMs?: number | null;
  operationDurationSource?: OperationDurationSource | null;
  operationDurationConfidence?: OperationDurationConfidence | null;
} {
  return durationMs === null
    ? {
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      }
    : {
        operationDurationMs: durationMs,
        operationDurationSource: "native",
        operationDurationConfidence: "high",
      };
}

export function pushSplitMessages(args: {
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

export function pushNonObjectEvent(args: {
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

export function extractGeminiEvents(payload: unknown): unknown[] {
  const record = asRecord(payload);
  const messages = asArray(record?.messages);
  if (messages.length > 0) {
    return messages;
  }

  return extractEvents(payload);
}

export function dedupeSegments(segments: EventSegment[]): EventSegment[] {
  const seen = new Set<string>();
  const deduped: EventSegment[] = [];

  for (const segment of segments) {
    if (segment.content.length === 0) {
      continue;
    }

    const key = `${segment.category}:${createHash("sha1").update(segment.content, "utf8").digest("hex")}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(segment);
  }

  return deduped;
}

export function extractPrimaryText(value: unknown): string {
  return extractText(value).join("\n").trim();
}

export function firstKnownTimestamp(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): string {
  const first = extractEventTimestamp(primary);
  if (first !== EPOCH_ISO) {
    return first;
  }

  return extractEventTimestamp(fallback);
}

export function safeJsonString(value: unknown): string {
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

export function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function extractCodexNativeDurationMs(value: unknown): number | null {
  const seconds = extractDurationSeconds(value);
  if (seconds === null) {
    return null;
  }

  return Math.trunc(seconds * 1000);
}

export function extractDurationSeconds(value: unknown): number | null {
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

export function parseNonNegativeNumber(value: unknown): number | null {
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

export function inferToolUseCategory(content: string): MessageCategory {
  const parsed = parseMaybeJson(content);
  const record = asRecord(parsed);
  if (!record) {
    return isLikelyEditOperation(content) ? "tool_edit" : "tool_use";
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
  return isLikelyEditOperation(joined) ? "tool_edit" : "tool_use";
}
