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
    ? "Search with quotes, AND/OR/NOT, parentheses, and term*."
    : "Search with words and term*.";
}

export function getAdvancedSearchToggleTitle(advancedSearchEnabled: boolean): string {
  return advancedSearchEnabled ? "Turn off advanced search." : "Turn on advanced search.";
}
