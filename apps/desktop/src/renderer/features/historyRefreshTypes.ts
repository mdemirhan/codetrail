import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";

import type { RefreshStrategy } from "../app/autoRefresh";
import type {
  BookmarkListResponse,
  HistoryMessage,
  HistorySelection,
  PendingMessagePageNavigation,
  ProjectCombinedDetail,
  ProjectSummary,
  ProjectViewMode,
  SessionDetail,
  SessionSummary,
} from "../app/types";
import type { StableListUpdateSource } from "../lib/projectUpdates";

export type HistoryRefreshMode = "session" | "bookmarks" | "project_all";
export type HistoryDetailMode = "flat" | "turn";
export type HistoryRefreshTarget = "bookmarks" | "session" | "project_all" | "turn" | null;

export type HistoryRefreshSelectionState = {
  historyMode: HistoryRefreshMode;
  historyDetailMode: HistoryDetailMode;
  effectiveHistoryPage: number;
  selectedProjectId: string;
  selectedSessionId: string;
  turnSourceSessionId: string;
  turnAnchorMessageId: string;
  turnVisualizationSelection: HistorySelection;
  canToggleTurnView: boolean;
  projectViewMode: ProjectViewMode;
};

export type HistoryRefreshDetailState = {
  detailMessages: HistoryMessage[];
  selectedProject: ProjectSummary | null;
  selectedSession: SessionSummary | null;
  sessionDetail: SessionDetail | null;
  projectCombinedDetail: ProjectCombinedDetail | null;
  bookmarksResponse: BookmarkListResponse;
  sessionTurnDetail: {
    totalCount?: number | null;
  } | null;
};

export type HistoryRefreshSortState = {
  messagePageSize: number;
  messageSortDirection: "asc" | "desc";
  bookmarkSortDirection: "asc" | "desc";
  projectAllSortDirection: "asc" | "desc";
  turnViewSortDirection: "asc" | "desc";
  activeMessageSortDirection: "asc" | "desc";
};

export type HistoryRefreshCatalogApi = {
  initialAutoRefreshStrategy: RefreshStrategy;
  loadProjects: (source?: StableListUpdateSource) => Promise<ProjectSummary[] | undefined>;
  loadSessions: (source?: StableListUpdateSource) => Promise<SessionSummary[] | undefined>;
  refreshTreeProjectSessions: (source?: StableListUpdateSource) => Promise<void>;
  treeProjectSessionsByProjectIdRef: MutableRefObject<Record<string, SessionSummary[]>>;
};

export type HistoryRefreshDetailApi = {
  loadBookmarks: () => Promise<unknown>;
  requestSessionDetailRefresh: () => void;
  requestProjectCombinedDetailRefresh: () => void;
  requestTurnDetailRefresh: () => void;
};

export type HistoryRefreshViewportBindings = {
  messageListRef: RefObject<HTMLDivElement | null>;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  sessionScrollTopRef: MutableRefObject<number>;
  pendingRestoredSessionScrollRef: MutableRefObject<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>;
  focusMessageId: string;
  visibleFocusedMessageId: string;
  focusedMessagePosition: number;
  focusedMessageRef: RefObject<HTMLDivElement | null>;
  pendingMessageAreaFocus: boolean;
  setPendingMessageAreaFocus: Dispatch<SetStateAction<boolean>>;
  pendingMessagePageNavigation: PendingMessagePageNavigation | null;
  loadedHistoryPage: number;
  setPendingMessagePageNavigation: Dispatch<SetStateAction<PendingMessagePageNavigation | null>>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
};
