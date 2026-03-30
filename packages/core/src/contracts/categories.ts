import type { MessageCategory } from "./canonical";

export const MESSAGE_CATEGORY_KEYS = [
  "user",
  "assistant",
  "tool_use",
  "tool_edit",
  "tool_result",
  "thinking",
  "system",
] as const satisfies ReadonlyArray<MessageCategory>;

export const MESSAGE_CATEGORY_ALIASES: Record<string, MessageCategory> = {
  tool_call: "tool_use",
  "tool-edit": "tool_edit",
};

export function normalizeMessageCategory(value: string): MessageCategory {
  const normalized = value.trim().toLowerCase();
  const aliased = MESSAGE_CATEGORY_ALIASES[normalized];
  if (aliased) {
    return aliased;
  }
  return (MESSAGE_CATEGORY_KEYS as readonly string[]).includes(normalized)
    ? (normalized as MessageCategory)
    : "system";
}

export function normalizeMessageCategories(values: string[]): MessageCategory[] {
  const selected = new Set<MessageCategory>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    const aliased = MESSAGE_CATEGORY_ALIASES[normalized];
    if (aliased) {
      selected.add(aliased);
      continue;
    }
    if ((MESSAGE_CATEGORY_KEYS as readonly string[]).includes(normalized)) {
      selected.add(normalized as MessageCategory);
    }
  }
  return MESSAGE_CATEGORY_KEYS.filter((value) => selected.has(value));
}

export function makeEmptyCategoryCounts(): Record<MessageCategory, number> {
  return {
    user: 0,
    assistant: 0,
    tool_use: 0,
    tool_edit: 0,
    tool_result: 0,
    thinking: 0,
    system: 0,
  };
}
