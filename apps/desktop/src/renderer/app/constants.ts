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

export const PROJECT_ALL_NAV_ID = "__project_all__";
export const BOOKMARKS_NAV_ID = "__bookmarks__";

export const PROVIDERS = [...UI_PROVIDER_VALUES];
export const CATEGORIES = [...UI_MESSAGE_CATEGORY_VALUES];
export const DEFAULT_MESSAGE_CATEGORIES: MessageCategory[] = ["user", "assistant"];

export const HISTORY_CATEGORY_SHORTCUTS: Record<MessageCategory, string> = {
  user: "Cmd/Ctrl+1",
  assistant: "Cmd/Ctrl+2",
  tool_edit: "Cmd/Ctrl+3",
  tool_use: "Cmd/Ctrl+4",
  tool_result: "Cmd/Ctrl+5",
  thinking: "Cmd/Ctrl+6",
  system: "Cmd/Ctrl+7",
};

export const HISTORY_CATEGORY_EXPAND_SHORTCUTS: Record<MessageCategory, string> = {
  user: "Cmd/Ctrl+Alt+1",
  assistant: "Cmd/Ctrl+Alt+2",
  tool_edit: "Cmd/Ctrl+Alt+3",
  tool_use: "Cmd/Ctrl+Alt+4",
  tool_result: "Cmd/Ctrl+Alt+5",
  thinking: "Cmd/Ctrl+Alt+6",
  system: "Cmd/Ctrl+Alt+7",
};

export const EMPTY_CATEGORY_COUNTS = {
  user: 0,
  assistant: 0,
  tool_use: 0,
  tool_edit: 0,
  tool_result: 0,
  thinking: 0,
  system: 0,
};

export const EMPTY_BOOKMARKS_RESPONSE: BookmarkListResponse = {
  projectId: "",
  totalCount: 0,
  filteredCount: 0,
  categoryCounts: EMPTY_CATEGORY_COUNTS,
  queryError: null,
  highlightPatterns: [],
  results: [],
};

export const EMPTY_SYSTEM_MESSAGE_REGEX_RULES: SystemMessageRegexRules = createProviderRecord(
  () => [],
);

export const SHORTCUT_ITEMS = [
  { group: "Search & Navigation", shortcut: "Cmd/Ctrl+F", description: "Search messages" },
  {
    group: "Search & Navigation",
    shortcut: "Cmd/Ctrl+Shift+F",
    description: "Open search",
  },
  { group: "Search & Navigation", shortcut: "Cmd/Ctrl+Left", description: "Previous page" },
  { group: "Search & Navigation", shortcut: "Cmd/Ctrl+Right", description: "Next page" },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Up",
    description: "Focus previous message or search result",
  },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Down",
    description: "Focus next message or search result",
  },
  { group: "Search & Navigation", shortcut: "Option+Up", description: "Select previous session" },
  { group: "Search & Navigation", shortcut: "Option+Down", description: "Select next session" },
  { group: "Search & Navigation", shortcut: "Ctrl+Up", description: "Select previous project" },
  { group: "Search & Navigation", shortcut: "Ctrl+Down", description: "Select next project" },
  {
    group: "Search & Navigation",
    shortcut: "Ctrl+U",
    description: "Page current message or search-result list up",
  },
  {
    group: "Search & Navigation",
    shortcut: "Ctrl+D",
    description: "Page current message or search-result list down",
  },
  {
    group: "Search & Navigation",
    shortcut: "Page Up",
    description: "Page current message or search-result list up",
  },
  {
    group: "Search & Navigation",
    shortcut: "Page Down",
    description: "Page current message or search-result list down",
  },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Shift+Up",
    description: "Page current message or search-result list up",
  },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Shift+Down",
    description: "Page current message or search-result list down",
  },
  { group: "Search & Navigation", shortcut: "Tab", description: "Cycle pane focus forward" },
  { group: "Search & Navigation", shortcut: "Shift+Tab", description: "Cycle pane focus backward" },
  { group: "Panels", shortcut: "Cmd/Ctrl+B", description: "Expand/collapse Projects pane" },
  {
    group: "Panels",
    shortcut: "Cmd/Ctrl+Shift+B",
    description: "Expand/collapse Sessions pane",
  },
  { group: "Panels", shortcut: "Cmd/Ctrl+E", description: "Expand/collapse session messages" },
  { group: "Panels", shortcut: "Cmd/Ctrl+Shift+M", description: "Toggle focus mode" },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+1",
    description: "Toggle User message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+1",
    description: "Expand/collapse User messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+2",
    description: "Toggle Assistant message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+2",
    description: "Expand/collapse Assistant messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+3",
    description: "Toggle Write message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+3",
    description: "Expand/collapse Write messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+4",
    description: "Toggle Tool Use message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+4",
    description: "Expand/collapse Tool Use messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+5",
    description: "Toggle Tool Result message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+5",
    description: "Expand/collapse Tool Result messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+6",
    description: "Toggle Thinking message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+6",
    description: "Expand/collapse Thinking messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+7",
    description: "Toggle System message filter",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd/Ctrl+Alt+7",
    description: "Expand/collapse System messages",
  },
  { group: "Refresh", shortcut: "Cmd/Ctrl+R", description: "Incremental refresh" },
  {
    group: "Refresh",
    shortcut: "Cmd/Ctrl+Shift+R",
    description: "Toggle auto-refresh",
  },
  { group: "System", shortcut: "Cmd/Ctrl+,", description: "Open settings" },
  { group: "System", shortcut: "Cmd/Ctrl++", description: "Zoom in" },
  { group: "System", shortcut: "Cmd/Ctrl+-", description: "Zoom out" },
  { group: "System", shortcut: "Cmd/Ctrl+0", description: "Reset zoom" },
  { group: "System", shortcut: "?", description: "Open help page" },
  { group: "System", shortcut: "Esc", description: "Close help / clear focused message" },
] as const;

export const COMMON_SYNTAX_ITEMS = [
  { syntax: "term", description: "Match term token" },
  { syntax: "term*", description: "Prefix wildcard", note: "Postfix only" },
  { syntax: "focus+on", description: "Punctuation like '+' can still match tokenized text" },
  { syntax: "focus-on", description: "Punctuation like '-' can still match tokenized text" },
  { syntax: "focus+on+something", description: "Multiple separators are supported in a token" },
] as const;

export const ADVANCED_SYNTAX_ITEMS = [
  { syntax: '"exact phrase"', description: "Match exact phrase" },
  { syntax: "A OR B", description: "Either side may match (advanced mode)" },
  { syntax: "A NOT B", description: "Exclude B from A matches (advanced mode)" },
  {
    syntax: '"and" / "or" / "not"',
    description: "Use quotes for literal words",
    note: "Unquoted AND / OR / NOT are operators",
  },
  { syntax: "(A OR B) C", description: "Use parentheses to group expressions" },
] as const;

export const MONO_FONT_STACKS: Record<MonoFontFamily, string> = {
  current: '"JetBrains Mono", "IBM Plex Mono", monospace',
  droid_sans_mono: '"Droid Sans Mono", "JetBrains Mono", "IBM Plex Mono", monospace',
};

export const REGULAR_FONT_STACKS: Record<RegularFontFamily, string> = {
  current: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  inter: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
