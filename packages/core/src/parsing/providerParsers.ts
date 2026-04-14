import { createHash } from "node:crypto";

import type {
  MessageCategory,
  OperationDurationConfidence,
  OperationDurationSource,
  Provider,
  TurnAnchorKind,
  TurnGroupingMode,
} from "../contracts/canonical";
import {
  extractCodetrailCompactedSnapshotText,
  isCodetrailCompactedSnapshotEvent,
} from "../providers/oversized/codex";
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

type ProviderPayloadParser = (args: ParseProviderPayloadArgs) => ParsedProviderMessage[];
type ProviderEventParser = (args: ParseProviderEventArgs) => ParseProviderEventResult;

function parseEventStreamPayload(
  args: ParseProviderPayloadArgs,
  eventExtractor: (payload: unknown) => unknown[],
): ParsedProviderMessage[] {
  const events = eventExtractor(args.payload);
  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, event] of events.entries()) {
    const result = parseProviderEvent({
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

export const PROVIDER_EVENT_PARSERS: Record<Provider, ProviderEventParser> = {
  claude: parseClaudeEvent,
  codex: parseCodexEvent,
  gemini: parseGeminiEvent,
  cursor: parseCursorEvent,
  copilot: parseCopilotEvent,
  copilot_cli: parseCopilotCliEvent,
};

export const PROVIDER_PAYLOAD_PARSERS: Record<Provider, ProviderPayloadParser> = {
  claude: (args) => parseEventStreamPayload(args, extractEvents),
  codex: (args) => parseEventStreamPayload(args, extractEvents),
  gemini: (args) => parseEventStreamPayload(args, extractGeminiEvents),
  cursor: (args) => parseEventStreamPayload(args, extractEvents),
  copilot: parseCopilotPayload,
  copilot_cli: (args) => parseEventStreamPayload(args, extractEvents),
};

// Each provider emits different event shapes, but all parsers normalize into the same stream of
// split messages so indexing/search can stay provider-agnostic.
export function parseProviderPayload(args: ParseProviderPayloadArgs): ParsedProviderMessage[] {
  return PROVIDER_PAYLOAD_PARSERS[args.provider](args);
}

export function parseProviderEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
  return PROVIDER_EVENT_PARSERS[args.provider](args);
}

function parseClaudeEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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
    return { messages: output, nextSequence: sequence };
  }

  const createdAt = firstKnownTimestamp(eventRecord, normalized);
  const usage = extractTokenUsage(messageRecord ?? eventRecord);
  const baseId =
    readString(eventRecord.uuid) ?? readString(eventRecord.id) ?? readString(normalized.id) ?? null;
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

  return {
    messages: output,
    nextSequence: pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage: usage,
      segments,
      fallbackRaw: event,
    }),
  };
}

function parseCodexEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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

function parseGeminiEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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

  return {
    messages: output,
    nextSequence: pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage: usage,
      segments: normalizedSegments,
      fallbackRaw: event,
    }),
  };
}

function parseCursorEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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

  const messageRecord = asRecord(eventRecord.message);
  const role = lowerString(
    eventRecord.role ??
      messageRecord?.role ??
      eventRecord.author ??
      messageRecord?.author ??
      eventRecord.sender ??
      messageRecord?.sender,
  );
  const createdAt = firstKnownTimestamp(eventRecord, messageRecord ?? eventRecord);
  const usage = extractTokenUsage(messageRecord ?? eventRecord);
  const baseId =
    readString(eventRecord.id) ??
    readString(eventRecord.uuid) ??
    readString(messageRecord?.id) ??
    readString(messageRecord?.uuid) ??
    null;
  const segments = dedupeSegments(parseCursorSegments(role, messageRecord ?? eventRecord));

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

  return {
    messages: output,
    nextSequence: pushSplitMessages({
      output,
      sessionId,
      sequence,
      baseId,
      createdAt,
      tokenUsage: usage,
      segments,
      fallbackRaw: event,
    }),
  };
}

function parseCursorSegments(role: string | null, event: Record<string, unknown>): EventSegment[] {
  const segments: EventSegment[] = [];
  const contentBlocks = asArray(event.content);

  for (const block of contentBlocks) {
    const blockRecord = asRecord(block);
    if (!blockRecord) {
      if (typeof block === "string" && block.length > 0) {
        const category = cursorRoleCategory(role, "assistant");
        segments.push({ category, content: stripCursorWrapperTags(block) });
      }
      continue;
    }

    const blockType = lowerString(blockRecord.type);
    const text = readString(blockRecord.text) ?? "";

    if (blockType === "text" || !blockType) {
      if (text.length === 0) {
        continue;
      }
      const cleaned = stripCursorWrapperTags(text);
      if (cleaned.length === 0) {
        continue;
      }
      const category = cursorRoleCategory(role, "assistant");
      segments.push({ category, content: cleaned });
      continue;
    }

    if (blockType === "thinking" || blockType === "reasoning") {
      const thinking = readString(blockRecord.thinking) ?? text;
      if (thinking.length > 0) {
        segments.push({ category: "thinking", content: thinking });
      }
      continue;
    }

    if (blockType === "tool_use" || blockType === "tool_call") {
      segments.push({ category: "tool_use", content: serializeUnknown(blockRecord) });
      continue;
    }

    if (blockType === "tool_result" || blockType === "tool_response") {
      const resultText = extractText(blockRecord.content ?? blockRecord)
        .join("\n")
        .trim();
      segments.push({
        category: "tool_result",
        content: resultText || serializeUnknown(blockRecord),
      });
      continue;
    }

    if (text.length > 0) {
      const category = cursorRoleCategory(role, "system");
      segments.push({ category, content: stripCursorWrapperTags(text) });
    }
  }

  if (segments.length === 0) {
    const fallback = extractText(event).join("\n").trim();
    if (fallback.length > 0) {
      const cleaned = stripCursorWrapperTags(fallback);
      if (cleaned.length > 0) {
        const category = cursorRoleCategory(role, "system");
        segments.push({ category, content: cleaned });
      }
    }
  }

  return segments;
}

function cursorRoleCategory(role: string | null, fallback: MessageCategory): MessageCategory {
  if (role === "user") {
    return "user";
  }
  if (role === "assistant" || role === "model") {
    return "assistant";
  }
  return fallback;
}

function parseCopilotPayload(args: ParseProviderPayloadArgs): ParsedProviderMessage[] {
  const record = asRecord(args.payload);
  const requests = asArray(record?.requests);
  if (requests.length === 0) {
    return [];
  }

  const output: ParsedProviderMessage[] = [];
  let sequence = 0;

  for (const [eventIndex, request] of requests.entries()) {
    const result = parseCopilotEvent({
      provider: args.provider,
      sessionId: args.sessionId,
      eventIndex,
      event: request,
      diagnostics: args.diagnostics,
      sequence,
    });
    output.push(...result.messages);
    sequence = result.nextSequence;
  }

  return output;
}

function parseCopilotEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
  const { sessionId, event, sequence } = args;
  const output: ParsedProviderMessage[] = [];
  const requestRecord = asRecord(event);
  if (!requestRecord) {
    return { messages: output, nextSequence: sequence };
  }

  const requestId = readString(requestRecord.requestId) ?? `${sessionId}:msg:${sequence}`;
  const timestamp = requestRecord.timestamp;
  const createdAt =
    typeof timestamp === "number" && Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : EPOCH_ISO;

  const messageRecord = asRecord(requestRecord.message);
  const userText = readString(messageRecord?.text) ?? "";
  let nextSequence = sequence;

  if (userText.length > 0) {
    output.push({
      id: `${requestId}:user`,
      createdAt,
      category: "user",
      content: userText,
      tokenInput: null,
      tokenOutput: null,
      operationDurationMs: null,
      operationDurationSource: null,
      operationDurationConfidence: null,
    });
    nextSequence += 1;
  }

  const responseItems = asArray(requestRecord.response);
  for (const [itemIndex, item] of responseItems.entries()) {
    const itemRecord = asRecord(item);
    if (!itemRecord) {
      continue;
    }

    const kind = readString(itemRecord.kind);
    const itemId = `${requestId}:resp:${itemIndex}`;

    if (!kind || kind === "markdownContent") {
      const value = readString(itemRecord.value);
      if (value && value.length > 0) {
        output.push({
          id: itemId,
          createdAt,
          category: "assistant",
          content: value,
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        });
        nextSequence += 1;
      }
      continue;
    }

    if (kind === "toolInvocationSerialized") {
      const toolId = readString(itemRecord.toolId) ?? "unknown_tool";
      const toolData = asRecord(itemRecord.toolSpecificData);
      const commandLine = readString(toolData?.commandLine);
      const content = commandLine
        ? serializeUnknown({ type: "tool_use", name: toolId, input: { command: commandLine } })
        : serializeUnknown({ type: "tool_use", name: toolId, input: toolData ?? {} });
      const category = inferToolUseCategory(content);

      output.push({
        id: itemId,
        createdAt,
        category,
        content,
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      });
      nextSequence += 1;
      continue;
    }

    if (kind === "progressMessage" || kind === "progressTask") {
      continue;
    }

    if (kind === "elicitation") {
      const title = readString(itemRecord.title) ?? "";
      const message = readString(itemRecord.message) ?? "";
      const elicitationText = [title, message].filter((s) => s.length > 0).join(": ");
      if (elicitationText.length > 0) {
        output.push({
          id: itemId,
          createdAt,
          category: "system",
          content: elicitationText,
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        });
        nextSequence += 1;
      }
    }
  }

  return { messages: output, nextSequence };
}

function parseCopilotCliEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
  const { sessionId, event, sequence } = args;
  const output: ParsedProviderMessage[] = [];
  const eventRecord = asRecord(event);
  if (!eventRecord) {
    return { messages: output, nextSequence: sequence };
  }

  const eventType = lowerString(eventRecord.type);
  const data = asRecord(eventRecord.data);
  const timestamp = readString(eventRecord.timestamp);
  const createdAt = timestamp ?? EPOCH_ISO;

  if (eventType === "user.message") {
    const content = readString(data?.content) ?? "";
    if (content.length > 0) {
      output.push({
        id: readString(data?.interactionId) ?? `${sessionId}:msg:${sequence}`,
        createdAt,
        category: "user",
        content,
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      });
      return { messages: output, nextSequence: sequence + 1 };
    }
    return { messages: output, nextSequence: sequence };
  }

  if (eventType === "assistant.message") {
    let nextSequence = sequence;
    const messageId = readString(data?.messageId) ?? `${sessionId}:msg:${sequence}`;
    const content = readString(data?.content) ?? "";

    if (content.length > 0) {
      output.push({
        id: messageId,
        createdAt,
        category: "assistant",
        content,
        tokenInput: null,
        tokenOutput: typeof data?.outputTokens === "number" ? data.outputTokens : null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      });
      nextSequence += 1;
    }

    const toolRequests = asArray(data?.toolRequests);
    for (const [index, toolReq] of toolRequests.entries()) {
      const toolRecord = asRecord(toolReq);
      if (!toolRecord) {
        continue;
      }
      const toolName = readString(toolRecord.name) ?? "tool";
      const toolCallId = readString(toolRecord.toolCallId) ?? `${messageId}:tool:${index}`;
      const toolArgs = asRecord(toolRecord.arguments) ?? {};
      const toolContent = serializeUnknown({
        type: "tool_use",
        id: toolCallId,
        name: toolName,
        input: toolArgs,
      });
      const category = inferToolUseCategory(toolContent);
      output.push({
        id: toolCallId,
        createdAt,
        category,
        content: toolContent,
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      });
      nextSequence += 1;
    }

    return { messages: output, nextSequence };
  }

  if (eventType === "tool.execution_complete") {
    const toolCallId = readString(data?.toolCallId);
    const result = asRecord(data?.result);
    const contentString = result ? readString(result.content) : null;
    const resultContent =
      contentString ??
      (result && Object.keys(result).some((k) => k !== "content") ? serializeUnknown(result) : null);
    if (resultContent && resultContent.length > 0) {
      output.push({
        id: toolCallId ? `${toolCallId}:result` : `${sessionId}:tool_result:${sequence}`,
        createdAt,
        category: "tool_result",
        content: resultContent,
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      });
      return { messages: output, nextSequence: sequence + 1 };
    }
    return { messages: output, nextSequence: sequence };
  }

  // Skip non-content events: session.start, assistant.turn_start/end, session.mode_changed, etc.
  return { messages: output, nextSequence: sequence };
}

const CURSOR_USER_QUERY_OPEN_RE = /<user_query>\s*/g;
const CURSOR_USER_QUERY_CLOSE_RE = /\s*<\/user_query>/g;
const CURSOR_WRAPPER_BLOCK_RES = [
  /<system_reminder>[\s\S]*?<\/system_reminder>/g,
  /<agent_skills>[\s\S]*?<\/agent_skills>/g,
  /<available_skills[\s\S]*?<\/available_skills>/g,
  /<user_info>[\s\S]*?<\/user_info>/g,
  /<open_and_recently_viewed_files>[\s\S]*?<\/open_and_recently_viewed_files>/g,
  /<agent_transcripts>[\s\S]*?<\/agent_transcripts>/g,
] as const;

function stripCursorWrapperTags(text: string): string {
  let result = text;
  // Cursor wraps prompts with extra XML-ish scaffolding that is useful to the agent but noisy in
  // history views. Strip the wrappers while preserving the human-readable text payload.
  result = result.replace(CURSOR_USER_QUERY_OPEN_RE, "").replace(CURSOR_USER_QUERY_CLOSE_RE, "");
  for (const pattern of CURSOR_WRAPPER_BLOCK_RES) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}

function parseClaudeSegments(
  sourceType: string | null,
  event: Record<string, unknown>,
): EventSegment[] {
  const segments: EventSegment[] = [];
  // Claude often co-locates assistant text, thinking, and tool traffic in one event. Keep them as
  // separate segments so downstream filters can treat each category independently.
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

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    // Tool calls are promoted into a synthetic JSON payload so the indexer can extract a stable
    // tool name/args pair later without depending on provider-specific field names.
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

function parseGeminiUserSegments(event: Record<string, unknown>): EventSegment[] {
  const segments: EventSegment[] = [];
  for (const block of parseGeminiBlocks(event)) {
    if (block.kind === "text") {
      const normalized = normalizeGeminiUserTextBlock(block.content);
      if (normalized) {
        segments.push(...normalized);
      } else {
        segments.push({ category: "user", content: block.content });
      }
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
  // Gemini exposes thoughts both as a top-level side channel and inline blocks. Preserve both so
  // the UI can show reasoning messages even when the provider mixes representations.
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

function normalizeGeminiUserTextBlock(content: string): EventSegment[] | null {
  const summary = summarizeGeminiAttachmentDump(content);
  if (!summary) {
    return null;
  }

  const segments: EventSegment[] = [];
  if (summary.leadingText.length > 0) {
    segments.push({ category: "user", content: summary.leadingText });
  }
  segments.push({ category: "system", content: summary.summaryText });
  return segments;
}

const GEMINI_ATTACHMENT_MARKER = "--- Content from referenced files ---";
const GEMINI_BINARY_PLACEHOLDER = "Cannot display content of binary file";
const MIN_GEMINI_ATTACHMENT_LINES = 8;

function summarizeGeminiAttachmentDump(
  content: string,
): { leadingText: string; summaryText: string } | null {
  const normalized = content.trim();
  if (normalized.length === 0) {
    return null;
  }

  const markerIndex = normalized.indexOf(GEMINI_ATTACHMENT_MARKER);
  let leadingText = normalized;
  let attachmentSection = "";
  let hasExplicitMarker = false;
  if (markerIndex >= 0) {
    hasExplicitMarker = true;
    leadingText = normalized.slice(0, markerIndex).trimEnd();
    attachmentSection = normalized.slice(markerIndex + GEMINI_ATTACHMENT_MARKER.length);
  } else if (normalized.includes(GEMINI_BINARY_PLACEHOLDER)) {
    leadingText = "";
    attachmentSection = normalized;
  } else {
    return null;
  }

  const stats = analyzeGeminiAttachmentSection(attachmentSection);
  if (!stats) {
    return null;
  }

  if (stats.totalIndicatorCount < MIN_GEMINI_ATTACHMENT_LINES) {
    return null;
  }

  const summaryText = buildGeminiAttachmentSummary(stats, hasExplicitMarker);
  return {
    leadingText,
    summaryText,
  };
}

type GeminiAttachmentStats = {
  referencedItemCount: number;
  binaryPlaceholderCount: number;
  totalIndicatorCount: number;
  samplePaths: string[];
};

function analyzeGeminiAttachmentSection(section: string): GeminiAttachmentStats | null {
  const lines = section.split(/\r?\n/);
  let referencedItemCount = 0;
  let binaryPlaceholderCount = 0;
  const samplePaths: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "<application/pdf>") {
      continue;
    }

    if (line.startsWith("---")) {
      continue;
    }

    const headerMatch = /^Content from\s+(.+?)(?:\s*:)?$/i.exec(line);
    if (headerMatch) {
      referencedItemCount += 1;
      const path = headerMatch[1]?.trim() ?? "";
      if (path.length > 0 && samplePaths.length < 3 && !samplePaths.includes(path)) {
        samplePaths.push(path);
      }
      continue;
    }

    if (line.includes(GEMINI_BINARY_PLACEHOLDER)) {
      binaryPlaceholderCount += 1;
    }
  }

  const totalIndicatorCount = referencedItemCount + binaryPlaceholderCount;
  if (totalIndicatorCount === 0) {
    return null;
  }

  return {
    referencedItemCount,
    binaryPlaceholderCount,
    totalIndicatorCount,
    samplePaths,
  };
}

function buildGeminiAttachmentSummary(
  stats: GeminiAttachmentStats,
  hasExplicitMarker: boolean,
): string {
  const descriptors: string[] = [];
  if (stats.referencedItemCount > 0) {
    descriptors.push(
      `${stats.referencedItemCount} referenced ${
        stats.referencedItemCount === 1 ? "item" : "items"
      }`,
    );
  }
  if (stats.binaryPlaceholderCount > 0) {
    descriptors.push(
      `${stats.binaryPlaceholderCount} binary placeholder${
        stats.binaryPlaceholderCount === 1 ? "" : "s"
      }`,
    );
  }
  if (descriptors.length === 0) {
    descriptors.push(`${stats.totalIndicatorCount} attachment lines`);
  }

  const exampleSuffix =
    stats.samplePaths.length > 0 ? ` Examples: ${stats.samplePaths.join(", ")}` : "";

  const markerContext = hasExplicitMarker ? " dump" : "";
  const omissionReason =
    stats.binaryPlaceholderCount > 0
      ? " Binary blobs omitted to keep history responsive."
      : " Attachment bodies omitted to keep history responsive.";

  return `[Gemini attachment${markerContext} truncated: ${descriptors.join(", ")}.${
    omissionReason + exampleSuffix
  }]`;
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

    const key = `${segment.category}:${createHash("sha1").update(segment.content, "utf8").digest("hex")}`;
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
