import type {
  IpcRequestInput,
  IpcResponse,
  MessageCategory,
  Provider,
} from "@codetrail/core/browser";

export type ProjectSummary = IpcResponse<"projects:list">["projects"][number];
export type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];
export type SessionListManyResponse = IpcResponse<"sessions:listMany">;
export type SessionDetail = IpcResponse<"sessions:getDetail">;
export type ProjectCombinedDetail = IpcResponse<"projects:getCombinedDetail">;
export type BookmarkListResponse = IpcResponse<"bookmarks:listProject">;
export type BookmarkStateResponse = IpcResponse<"bookmarks:getStates">;
export type SearchQueryResponse = IpcResponse<"search:query">;
export type SearchResult = SearchQueryResponse["results"][number];
export type SettingsInfoResponse = IpcResponse<"app:getSettingsInfo">;
export type WatchStatsResponse = IpcResponse<"watcher:getStats">;
export type WatchLiveStatusResponse = IpcResponse<"watcher:getLiveStatus">;
export type ClaudeHookStateResponse = WatchLiveStatusResponse["claudeHookState"];
export type PaneStateSnapshot = IpcResponse<"ui:getPaneState"> & IpcResponse<"indexer:getConfig">;

export type HistoryMessage =
  | SessionDetail["messages"][number]
  | ProjectCombinedDetail["messages"][number];

export type MainView = "history" | "search" | "settings" | "help";
export type SortDirection = "asc" | "desc";
export type ProjectViewMode = "list" | "tree";
export type ProjectSortField = "last_active" | "name";

export type HistorySelection =
  | { mode: "project_all"; projectId: string }
  | { mode: "bookmarks"; projectId: string }
  | { mode: "session"; projectId: string; sessionId: string };

export type SessionPaneNavigationItem =
  | { id: "__project_all__"; kind: "project_all" }
  | { id: "__bookmarks__"; kind: "bookmarks" }
  | { id: string; kind: "session"; sessionId: string };

export type HistorySelectionMode = HistorySelection["mode"];
export type HistorySelectionCommitMode = "immediate" | "debounced_project" | "debounced_session";
export type HistorySearchNavigation = {
  projectId: string;
  sessionId: string;
  messageId: string;
  sourceId: string;
  historyCategories: MessageCategory[];
};

export type PendingRevealTarget = {
  sourceId: string;
  messageId: string;
};

export type TreeAutoRevealSessionRequest = {
  projectId: string;
  sessionId: string;
};

export type PendingMessagePageNavigation = {
  direction: "previous" | "next";
  targetPage: number;
};

export type ProviderCounts = Record<Provider, number>;
export type HistoryExportScope = IpcRequestInput<"history:exportMessages">["scope"];
