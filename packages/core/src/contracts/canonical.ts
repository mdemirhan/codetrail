import { z } from "zod";

export const providerSchema = z.enum(["claude", "codex", "gemini"]);
export type Provider = z.infer<typeof providerSchema>;

export const messageCategorySchema = z.enum([
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
]);

export type MessageCategory = z.infer<typeof messageCategorySchema>;

export const canonicalMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  provider: providerSchema,
  category: messageCategorySchema,
  content: z.string(),
  createdAt: z.string(),
  tokenInput: z.number().int().nonnegative().nullable(),
  tokenOutput: z.number().int().nonnegative().nullable(),
});

export type CanonicalMessage = z.infer<typeof canonicalMessageSchema>;
