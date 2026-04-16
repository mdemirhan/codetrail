import {
  asArray,
  asRecord,
  extractEvents,
  extractText,
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
  extractPrimaryText,
  firstKnownTimestamp,
  parseEventStreamPayload,
  pushNonObjectEvent,
  pushSplitMessages,
} from "../../parsing/providerParserShared";

export const parseCursorPayload = (args: ParseProviderPayloadArgs): ParsedProviderMessage[] =>
  parseEventStreamPayload(args, extractEvents, parseCursorEvent);

export function parseCursorEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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

function cursorRoleCategory(
  role: string | null,
  fallback: "assistant" | "system",
): "user" | "assistant" | "system" {
  if (role === "user") {
    return "user";
  }
  if (role === "assistant" || role === "model") {
    return "assistant";
  }
  return fallback;
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
  result = result.replace(CURSOR_USER_QUERY_OPEN_RE, "").replace(CURSOR_USER_QUERY_CLOSE_RE, "");
  for (const pattern of CURSOR_WRAPPER_BLOCK_RES) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}
