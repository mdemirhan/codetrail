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
  user: "Cmd+1",
  assistant: "Cmd+2",
  tool_edit: "Cmd+3",
  tool_use: "Cmd+4",
  tool_result: "Cmd+5",
  thinking: "Cmd+6",
  system: "Cmd+7",
};

export const HISTORY_CATEGORY_EXPAND_SHORTCUTS: Record<MessageCategory, string> = {
  user: "Cmd+Option+1",
  assistant: "Cmd+Option+2",
  tool_edit: "Cmd+Option+3",
  tool_use: "Cmd+Option+4",
  tool_result: "Cmd+Option+5",
  thinking: "Cmd+Option+6",
  system: "Cmd+Option+7",
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

export const SHORTCUT_ITEMS = [
  { group: "Search & Navigation", shortcut: "Cmd+F", description: "Search current view" },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Shift+F",
    description: "Open global search",
  },
  { group: "Search & Navigation", shortcut: "Cmd+Left", description: "Previous page" },
  { group: "Search & Navigation", shortcut: "Cmd+Right", description: "Next page" },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Up",
    description: "Previous message or result",
  },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Down",
    description: "Next message or result",
  },
  { group: "Search & Navigation", shortcut: "Option+Up", description: "Previous session" },
  { group: "Search & Navigation", shortcut: "Option+Down", description: "Next session" },
  { group: "Search & Navigation", shortcut: "Ctrl+Up", description: "Previous project" },
  { group: "Search & Navigation", shortcut: "Ctrl+Down", description: "Next project" },
  {
    group: "Search & Navigation",
    shortcut: "Ctrl+U",
    description: "Page up in current list",
  },
  {
    group: "Search & Navigation",
    shortcut: "Ctrl+D",
    description: "Page down in current list",
  },
  {
    group: "Search & Navigation",
    shortcut: "Page Up",
    description: "Page up in current list",
  },
  {
    group: "Search & Navigation",
    shortcut: "Page Down",
    description: "Page down in current list",
  },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Shift+Up",
    description: "Page up in current list",
  },
  {
    group: "Search & Navigation",
    shortcut: "Cmd+Shift+Down",
    description: "Page down in current list",
  },
  { group: "Search & Navigation", shortcut: "Tab", description: "Next pane" },
  { group: "Search & Navigation", shortcut: "Shift+Tab", description: "Previous pane" },
  { group: "Panels", shortcut: "Cmd+B", description: "Toggle Projects pane" },
  {
    group: "Panels",
    shortcut: "Cmd+Shift+B",
    description: "Toggle Sessions pane",
  },
  { group: "Panels", shortcut: "Cmd+E", description: "Expand or collapse all messages" },
  { group: "Panels", shortcut: "Cmd+Shift+M", description: "Toggle focus mode" },
  {
    group: "Message Filters",
    shortcut: "Cmd+1",
    description: "Show or hide User messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+1",
    description: "Expand or collapse User messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+2",
    description: "Show or hide Assistant messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+2",
    description: "Expand or collapse Assistant messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+3",
    description: "Show or hide Write messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+3",
    description: "Expand or collapse Write messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+4",
    description: "Show or hide Tool Use messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+4",
    description: "Expand or collapse Tool Use messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+5",
    description: "Show or hide Tool Result messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+5",
    description: "Expand or collapse Tool Result messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+6",
    description: "Show or hide Thinking messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+6",
    description: "Expand or collapse Thinking messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+7",
    description: "Show or hide System messages",
  },
  {
    group: "Message Filters",
    shortcut: "Cmd+Option+7",
    description: "Expand or collapse System messages",
  },
  { group: "Refresh", shortcut: "Cmd+R", description: "Refresh now" },
  {
    group: "Refresh",
    shortcut: "Cmd+Shift+R",
    description: "Toggle auto-refresh",
  },
  { group: "System", shortcut: "Cmd+,", description: "Open settings" },
  { group: "System", shortcut: "Cmd++", description: "Zoom in" },
  { group: "System", shortcut: "Cmd+-", description: "Zoom out" },
  { group: "System", shortcut: "Cmd+0", description: "Reset zoom" },
  { group: "System", shortcut: "?", description: "Open help" },
  { group: "System", shortcut: "Esc", description: "Close help or clear message focus" },
] as const;

export const COMMON_SYNTAX_ITEMS = [
  { syntax: "term", description: "Match a word" },
  { syntax: "term*", description: "Match words with this prefix", note: "* only works at the end" },
  { syntax: "focus+on", description: "Punctuation can still match" },
  { syntax: "focus-on", description: "Punctuation can still match" },
  { syntax: "focus+on+something", description: "Multiple separators still match" },
] as const;

export const ADVANCED_SYNTAX_ITEMS = [
  { syntax: '"exact phrase"', description: "Match an exact phrase" },
  { syntax: "A OR B", description: "Match either A or B" },
  { syntax: "A NOT B", description: "Match A without B" },
  {
    syntax: '"and" / "or" / "not"',
    description: "Match these words literally",
    note: "Unquoted AND / OR / NOT are operators",
  },
  { syntax: "(A OR B) C", description: "Group terms with parentheses" },
] as const;

export const MONO_FONT_STACKS: Record<MonoFontFamily, string> = {
  current: '"JetBrains Mono", "IBM Plex Mono", monospace',
  droid_sans_mono: '"Droid Sans Mono", "JetBrains Mono", "IBM Plex Mono", monospace',
};

export const REGULAR_FONT_STACKS: Record<RegularFontFamily, string> = {
  current: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  inter: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
