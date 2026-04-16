import { EPOCH_ISO, asArray, asRecord, readString, serializeUnknown } from "../../parsing/helpers";
import type {
  ParseProviderEventArgs,
  ParseProviderEventResult,
  ParseProviderPayloadArgs,
  ParsedProviderMessage,
} from "../../parsing/providerParserShared";
import { inferToolUseCategory } from "../../parsing/providerParserShared";

export function parseCopilotPayload(args: ParseProviderPayloadArgs): ParsedProviderMessage[] {
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

export function parseCopilotEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
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
