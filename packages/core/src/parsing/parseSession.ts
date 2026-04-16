import { canonicalMessageSchema } from "../contracts/canonical";
import { getProviderAdapter } from "../providers";

import {
  type ParseSessionInput,
  type ParseSessionResult,
  type ParserDiagnostic,
  parseSessionInputSchema,
} from "./contracts";
import type { ParsedProviderMessage } from "./providerParserShared";

// parseSession is the narrow boundary between provider-specific transcript shapes and the
// canonical message model used everywhere else in the app.
export function parseSession(input: ParseSessionInput): ParseSessionResult {
  const validated = parseSessionInputSchema.parse(input);
  const adapter = getProviderAdapter(validated.provider);
  const diagnostics: ParserDiagnostic[] = [];
  const messages = normalizeParsedMessages(
    validated.provider,
    validated.sessionId,
    diagnostics,
    adapter.parsePayload({
      provider: validated.provider,
      sessionId: validated.sessionId,
      payload: validated.payload,
      diagnostics,
    }),
  );

  if (messages.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "parser.no_events_found",
      provider: validated.provider,
      sessionId: validated.sessionId,
      eventIndex: null,
      message: "No events were discovered in payload; returning empty message list.",
    });
  }

  return {
    messages,
    diagnostics,
  };
}

export function parseSessionEvent(args: {
  provider: ParseSessionInput["provider"];
  sessionId: ParseSessionInput["sessionId"];
  eventIndex: number;
  event: unknown;
  diagnostics: ParserDiagnostic[];
  sequence: number;
}): {
  messages: ParseSessionResult["messages"];
  nextSequence: number;
} {
  const adapter = getProviderAdapter(args.provider);
  const parsed = adapter.parseEvent({
    provider: args.provider,
    sessionId: args.sessionId,
    eventIndex: args.eventIndex,
    event: args.event,
    diagnostics: args.diagnostics,
    sequence: args.sequence,
  });

  return {
    messages: normalizeParsedMessages(
      args.provider,
      args.sessionId,
      args.diagnostics,
      parsed.messages,
    ),
    nextSequence: parsed.nextSequence,
  };
}

function normalizeParsedMessages(
  provider: ParseSessionInput["provider"],
  sessionId: ParseSessionInput["sessionId"],
  diagnostics: ParserDiagnostic[],
  messages: ParsedProviderMessage[],
): ParseSessionResult["messages"] {
  return messages.flatMap((message) => {
    const candidate = {
      id: message.id,
      sessionId,
      provider,
      category: message.category,
      content: message.content,
      createdAt: message.createdAt,
      tokenInput: message.tokenInput,
      tokenOutput: message.tokenOutput,
      operationDurationMs: message.operationDurationMs ?? null,
      operationDurationSource: message.operationDurationSource ?? null,
      operationDurationConfidence: message.operationDurationConfidence ?? null,
      turnGroupId: message.turnGroupId ?? null,
      turnGroupingMode: message.turnGroupingMode ?? "heuristic",
      turnAnchorKind: message.turnAnchorKind ?? null,
      nativeTurnId: message.nativeTurnId ?? null,
    };

    // Provider parsers are intentionally permissive. Canonical validation catches anything that
    // still does not satisfy the shared contract before it reaches indexing/search.
    const parsedMessage = canonicalMessageSchema.safeParse(candidate);
    if (!parsedMessage.success) {
      diagnostics.push({
        severity: "error",
        code: "parser.invalid_canonical_message",
        provider,
        sessionId,
        eventIndex: null,
        message: `Failed canonical validation: ${parsedMessage.error.message}`,
      });

      return [];
    }

    return [parsedMessage.data];
  });
}
