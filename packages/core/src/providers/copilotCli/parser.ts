import {
  EPOCH_ISO,
  asArray,
  asRecord,
  extractEvents,
  lowerString,
  readString,
  serializeUnknown,
} from "../../parsing/helpers";
import {
  type ParseProviderEventArgs,
  type ParseProviderEventResult,
  type ParseProviderPayloadArgs,
  type ParsedProviderMessage,
  inferToolUseCategory,
  parseEventStreamPayload,
} from "../../parsing/providerParserShared";

export const parseCopilotCliPayload = (args: ParseProviderPayloadArgs): ParsedProviderMessage[] =>
  parseEventStreamPayload(args, extractEvents, parseCopilotCliEvent);

export function parseCopilotCliEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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
      (result && Object.keys(result).some((k) => k !== "content")
        ? serializeUnknown(result)
        : null);
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

  return { messages: output, nextSequence: sequence };
}
