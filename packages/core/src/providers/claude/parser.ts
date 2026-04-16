import {
  asRecord,
  extractEvents,
  extractTokenUsage,
  lowerString,
  readString,
} from "../../parsing/helpers";
import {
  type EventSegment,
  type ParseProviderEventArgs,
  type ParseProviderEventResult,
  type ParseProviderPayloadArgs,
  type ParsedProviderMessage,
  dedupeSegments,
  extractPrimaryText,
  firstKnownTimestamp,
  parseEventStreamPayload,
  parseStructuredBlocks,
  pushNonObjectEvent,
  pushSplitMessages,
} from "../../parsing/providerParserShared";

export const parseClaudePayload = (args: ParseProviderPayloadArgs): ParsedProviderMessage[] =>
  parseEventStreamPayload(args, extractEvents, parseClaudeEvent);

export function parseClaudeEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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
