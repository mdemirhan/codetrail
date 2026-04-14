import { z } from "zod";

export const providerSchema = z.enum([
  "claude",
  "codex",
  "gemini",
  "cursor",
  "copilot",
  "copilot_cli",
]);
export type Provider = z.infer<typeof providerSchema>;
export const PROVIDER_VALUES = providerSchema.options;

export const messageCategorySchema = z.enum([
  "user",
  "assistant",
  "tool_use",
  "tool_edit",
  "tool_result",
  "thinking",
  "system",
]);

export type MessageCategory = z.infer<typeof messageCategorySchema>;

export const operationDurationSourceSchema = z.enum(["native", "derived"]);
export type OperationDurationSource = z.infer<typeof operationDurationSourceSchema>;

export const operationDurationConfidenceSchema = z.enum(["high", "low"]);
export type OperationDurationConfidence = z.infer<typeof operationDurationConfidenceSchema>;

export const turnGroupingModeSchema = z.enum(["native", "hybrid", "heuristic"]);
export type TurnGroupingMode = z.infer<typeof turnGroupingModeSchema>;

export const turnAnchorKindSchema = z.enum(["user_prompt", "synthetic_control"]);
export type TurnAnchorKind = z.infer<typeof turnAnchorKindSchema>;

export const canonicalMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  provider: providerSchema,
  category: messageCategorySchema,
  content: z.string(),
  createdAt: z.string(),
  tokenInput: z.number().int().nonnegative().nullable(),
  tokenOutput: z.number().int().nonnegative().nullable(),
  operationDurationMs: z.number().int().nonnegative().nullable(),
  operationDurationSource: operationDurationSourceSchema.nullable(),
  operationDurationConfidence: operationDurationConfidenceSchema.nullable(),
  turnGroupId: z.string().min(1).nullable(),
  turnGroupingMode: turnGroupingModeSchema,
  turnAnchorKind: turnAnchorKindSchema.nullable(),
  nativeTurnId: z.string().min(1).nullable(),
});

export type CanonicalMessage = z.infer<typeof canonicalMessageSchema>;
