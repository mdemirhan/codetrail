export const SEARCH_PLACEHOLDERS = {
  historyBookmarks: "Search in bookmarks (postfix wildcard only: term*)...",
  historyProjectSessions: "Search in project sessions (postfix wildcard only: term*)...",
  historySession: "Search in session (postfix wildcard only: term*)...",
  globalMessages: "Search message text with plain words. Example: build error deploy*",
  globalProjects: "Filter by project name",
  sidebarProjects: "Filter projects...",
} as const;

export function getSearchQueryPlaceholder(advancedSearchEnabled: boolean): string {
  return advancedSearchEnabled
    ? 'Advanced search: try "build error" AND deploy* or auth AND (timeout OR retry)'
    : SEARCH_PLACEHOLDERS.globalMessages;
}

export function getSearchQueryTooltip(advancedSearchEnabled: boolean): string {
  return advancedSearchEnabled
    ? 'Advanced search is enabled. Use quoted phrases, AND/OR/NOT, parentheses, and postfix wildcard syntax like term*. Example: "build error" AND deploy*. Refer to Help for more examples and syntax details.'
    : "Standard search is enabled. Type plain words to match message text, and use postfix wildcard syntax like term* when needed. Turn on Advanced Search for quoted phrases, boolean operators, and grouping. Refer to Help for more.";
}

export function getAdvancedSearchToggleTitle(advancedSearchEnabled: boolean): string {
  return advancedSearchEnabled
    ? 'Advanced search is on. You can use quoted phrases, AND/OR/NOT, parentheses, and postfix wildcard syntax like term*. Example: "build error" AND deploy*. Turn this off to go back to plain text search. Refer to Help for more.'
    : "Advanced search is off. Search works like plain text matching, with optional postfix wildcard syntax like term*. Turn this on if you want quoted phrases, AND/OR/NOT, and grouped expressions with parentheses. Refer to Help for more.";
}
