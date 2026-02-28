import { canonicalMessageSchema } from "../contracts/canonical";

import {
  type ParseSessionInput,
  type ParseSessionResult,
  type ParserDiagnostic,
  parseSessionInputSchema,
  parseSessionResultSchema,
} from "./contracts";
import { parseProviderPayload } from "./providerParsers";

export function parseSession(input: ParseSessionInput): ParseSessionResult {
  const validated = parseSessionInputSchema.parse(input);
  const diagnostics: ParserDiagnostic[] = [];
  const messages = parseProviderPayload({
    provider: validated.provider,
    sessionId: validated.sessionId,
    payload: validated.payload,
    diagnostics,
  }).map((message) => {
    const candidate = {
      id: message.id,
      sessionId: validated.sessionId,
      provider: validated.provider,
      category: message.category,
      content: message.content,
      createdAt: message.createdAt,
      tokenInput: message.tokenInput,
      tokenOutput: message.tokenOutput,
      operationDurationMs: message.operationDurationMs ?? null,
      operationDurationSource: message.operationDurationSource ?? null,
      operationDurationConfidence: message.operationDurationConfidence ?? null,
    };

    const parsedMessage = canonicalMessageSchema.safeParse(candidate);
    if (!parsedMessage.success) {
      diagnostics.push({
        severity: "error",
        code: "parser.invalid_canonical_message",
        provider: validated.provider,
        sessionId: validated.sessionId,
        eventIndex: null,
        message: `Failed canonical validation: ${parsedMessage.error.message}`,
      });

      return {
        ...candidate,
        content: String(candidate.content),
      };
    }

    return parsedMessage.data;
  });

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

  return parseSessionResultSchema.parse({
    messages,
    diagnostics,
  });
}
