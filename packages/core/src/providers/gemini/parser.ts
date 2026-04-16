import {
  asArray,
  asRecord,
  extractEventTimestamp,
  extractTokenUsage,
  lowerString,
  readString,
} from "../../parsing/helpers";
import {
  type EventSegment,
  type ParseProviderEventArgs,
  type ParseProviderEventResult,
  type ParseProviderPayloadArgs,
  type ParsedBlock,
  type ParsedProviderMessage,
  dedupeSegments,
  extractGeminiEvents,
  extractPrimaryText,
  parseEventStreamPayload,
  parseStructuredBlocks,
  pushNonObjectEvent,
  pushSplitMessages,
} from "../../parsing/providerParserShared";

export const parseGeminiPayload = (args: ParseProviderPayloadArgs): ParsedProviderMessage[] =>
  parseEventStreamPayload(args, extractGeminiEvents, parseGeminiEvent);

export function parseGeminiEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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
