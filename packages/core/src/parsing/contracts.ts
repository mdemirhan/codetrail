import { z } from "zod";

import { canonicalMessageSchema, providerSchema } from "../contracts/canonical";

export const parserSeveritySchema = z.enum(["warning", "error"]);

export const parserDiagnosticSchema = z.object({
  severity: parserSeveritySchema,
  code: z.string().min(1),
  provider: providerSchema,
  sessionId: z.string().min(1),
  eventIndex: z.number().int().nonnegative().nullable(),
  message: z.string().min(1),
});

export const parseSessionInputSchema = z.object({
  provider: providerSchema,
  sessionId: z.string().min(1),
  payload: z.unknown(),
});

export const parseSessionResultSchema = z.object({
  messages: z.array(canonicalMessageSchema),
  diagnostics: z.array(parserDiagnosticSchema),
});

export type ParserDiagnostic = z.infer<typeof parserDiagnosticSchema>;
export type ParseSessionInput = z.infer<typeof parseSessionInputSchema>;
export type ParseSessionResult = z.infer<typeof parseSessionResultSchema>;
