import {
  type MessageCategory,
  type SystemMessageRegexRules,
  createProviderRecord,
} from "@codetrail/core/browser";

import {
  type MonoFontFamily,
  type RegularFontFamily,
  UI_MESSAGE_CATEGORY_VALUES,
  UI_PROVIDER_VALUES,
} from "../../shared/uiPreferences";
import type { BookmarkListResponse } from "./types";

export const PAGE_SIZE = 100;
export const SEARCH_PAGE_SIZE = 100;
export const COLLAPSED_PANE_WIDTH = 36;
export const MESSAGE_ID_BATCH_SIZE = 500;

export const PROJECT_ALL_NAV_ID = "__project_all__";
export const BOOKMARKS_NAV_ID = "__bookmarks__";

export const PROVIDERS = [...UI_PROVIDER_VALUES];
export const CATEGORIES = [...UI_MESSAGE_CATEGORY_VALUES];
export const DEFAULT_MESSAGE_CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_use",
  "tool_edit",
  "tool_result",
];
export const DEFAULT_EXPANDED_MESSAGE_CATEGORIES: MessageCategory[] = ["user", "assistant"];
export const DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_use",
];
export const DEFAULT_TURN_VIEW_EXPANDED_CATEGORIES: MessageCategory[] = ["assistant"];

export const EMPTY_CATEGORY_COUNTS = {
  user: 0,
  assistant: 0,
  tool_use: 0,
  tool_edit: 0,
  tool_result: 0,
  thinking: 0,
  system: 0,
};

export const EMPTY_PROVIDER_COUNTS = createProviderRecord(() => 0);

export const EMPTY_BOOKMARKS_RESPONSE: BookmarkListResponse = {
  projectId: "",
  totalCount: 0,
  filteredCount: 0,
  page: 0,
  pageSize: PAGE_SIZE,
  categoryCounts: EMPTY_CATEGORY_COUNTS,
  queryError: null,
  highlightPatterns: [],
  results: [],
};

export const EMPTY_SYSTEM_MESSAGE_REGEX_RULES: SystemMessageRegexRules = createProviderRecord(
  () => [],
);

export const COMMON_SYNTAX_ITEMS = [
  { syntax: "react", description: "Match a word" },
  { syntax: "react*", description: "Prefix match (e.g. reactive, reactivity)" },
  { syntax: "focus+on", description: "Multiple terms - punctuation still matches" },
] as const;

export const ADVANCED_SYNTAX_ITEMS = [
  { syntax: '"exact phrase"', description: "Literal phrase match" },
  { syntax: "A OR B", description: "Match either term" },
  { syntax: "A NOT B", description: "Exclude a term" },
  { syntax: "(A OR B) C", description: "Group with parentheses" },
  { syntax: '"and" / "or" / "not"', description: "Quote operators to match literally" },
] as const;

export const MONO_FONT_STACKS: Record<MonoFontFamily, string> = {
  current: '"JetBrains Mono", "IBM Plex Mono", monospace',
  droid_sans_mono: '"Droid Sans Mono", "JetBrains Mono", "IBM Plex Mono", monospace',
};

export const REGULAR_FONT_STACKS: Record<RegularFontFamily, string> = {
  current: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  inter: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  lexend: '"Lexend", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
