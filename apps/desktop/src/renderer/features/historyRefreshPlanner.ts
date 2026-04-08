import type { SessionSummary } from "../app/types";
import { getMessageListFingerprint } from "./historyControllerShared";
import type { RefreshContext } from "./historyControllerTypes";
import {
  getHistoryRefreshScopeKey,
  getRefreshBaselineTotalCount,
  isLiveEdgePage,
  isPinnedToVisualRefreshEdge,
} from "./historyRefreshPolicy";
import type {
  HistoryRefreshDetailState,
  HistoryRefreshSelectionState,
  HistoryRefreshSortState,
  HistoryRefreshTarget,
} from "./historyRefreshTypes";

function getVisibleMessageAnchor(container: HTMLElement): {
  referenceMessageId: string;
  referenceOffsetTop: number;
} | null {
  const rect = container.getBoundingClientRect();
  const probeX = rect.left + Math.min(24, Math.max(1, rect.width / 2));
  const probeY = rect.top + Math.min(24, Math.max(1, rect.height / 4));
  const elementAtPoint =
    typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(probeX, probeY)
      : null;
  const anchor =
    elementAtPoint instanceof HTMLElement
      ? elementAtPoint.closest<HTMLElement>("[data-history-message-id]")
      : null;
  if (anchor && container.contains(anchor)) {
    return {
      referenceMessageId: anchor.getAttribute("data-history-message-id") ?? "",
      referenceOffsetTop: anchor.offsetTop,
    };
  }

  const firstMessage = container.querySelector<HTMLElement>("[data-history-message-id]");
  if (!firstMessage) {
    return null;
  }
  return {
    referenceMessageId: firstMessage.getAttribute("data-history-message-id") ?? "",
    referenceOffsetTop: firstMessage.offsetTop,
  };
}

export function getRefreshSortDirection(
  selection: Pick<HistoryRefreshSelectionState, "historyMode" | "historyDetailMode">,
  sortState: Pick<
    HistoryRefreshSortState,
    | "bookmarkSortDirection"
    | "messageSortDirection"
    | "projectAllSortDirection"
    | "turnViewSortDirection"
  >,
): "asc" | "desc" {
  if (selection.historyDetailMode === "turn") {
    return sortState.turnViewSortDirection;
  }
  if (selection.historyMode === "project_all") {
    return sortState.projectAllSortDirection;
  }
  if (selection.historyMode === "bookmarks") {
    return sortState.bookmarkSortDirection;
  }
  return sortState.messageSortDirection;
}

export function buildRefreshContext({
  refreshId,
  container,
  selection,
  detailState,
  sortState,
}: {
  refreshId: number;
  container: HTMLDivElement | null;
  selection: Pick<
    HistoryRefreshSelectionState,
    | "historyMode"
    | "historyDetailMode"
    | "effectiveHistoryPage"
    | "selectedProjectId"
    | "selectedSessionId"
    | "turnSourceSessionId"
    | "turnAnchorMessageId"
  >;
  detailState: Pick<
    HistoryRefreshDetailState,
    | "detailMessages"
    | "selectedProject"
    | "selectedSession"
    | "sessionDetail"
    | "projectCombinedDetail"
    | "bookmarksResponse"
    | "sessionTurnDetail"
  >;
  sortState: Pick<
    HistoryRefreshSortState,
    | "messagePageSize"
    | "bookmarkSortDirection"
    | "messageSortDirection"
    | "projectAllSortDirection"
    | "turnViewSortDirection"
  >;
}): RefreshContext {
  const sortDirection = getRefreshSortDirection(selection, sortState);
  const scopeKey =
    selection.historyDetailMode === "turn"
      ? `turn:${selection.turnSourceSessionId}:${selection.turnAnchorMessageId}`
      : getHistoryRefreshScopeKey(
          selection.historyMode,
          selection.selectedProjectId,
          selection.selectedSessionId,
        );
  const baselineTotalCount =
    selection.historyDetailMode === "turn"
      ? (detailState.sessionTurnDetail?.totalCount ?? detailState.detailMessages.length)
      : getRefreshBaselineTotalCount({
          historyMode: selection.historyMode,
          selectedProject: detailState.selectedProject,
          selectedSession: detailState.selectedSession,
          sessionDetail: detailState.sessionDetail,
          projectCombinedDetailTotalCount: detailState.projectCombinedDetail?.totalCount,
          bookmarksResponse: detailState.bookmarksResponse,
        });
  const isAtVisualEdge = container
    ? isPinnedToVisualRefreshEdge({
        sortDirection,
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      })
    : false;
  const isOnLiveEdgePage =
    selection.historyMode !== "bookmarks" &&
    isLiveEdgePage({
      sortDirection,
      page: selection.effectiveHistoryPage,
      totalCount: baselineTotalCount,
      pageSize: sortState.messagePageSize,
    });
  const followEligible = isAtVisualEdge && isOnLiveEdgePage;

  let scrollPreservation: RefreshContext["scrollPreservation"] = null;
  let prevMessageIds = "";
  if (followEligible) {
    prevMessageIds = getMessageListFingerprint(detailState.detailMessages);
  } else if (container) {
    const anchor = getVisibleMessageAnchor(container);
    scrollPreservation = anchor
      ? {
          scrollTop: container.scrollTop,
          referenceMessageId: anchor.referenceMessageId,
          referenceOffsetTop: anchor.referenceOffsetTop,
        }
      : null;
  }

  return {
    refreshId,
    originPage: selection.effectiveHistoryPage,
    scopeKey,
    baselineTotalCount,
    followEligible,
    scrollPreservation,
    prevMessageIds,
  };
}

export function getManualRefreshTarget({
  historyViewActive,
  selection,
}: {
  historyViewActive: boolean;
  selection: Pick<
    HistoryRefreshSelectionState,
    | "historyMode"
    | "historyDetailMode"
    | "selectedProjectId"
    | "selectedSessionId"
    | "canToggleTurnView"
  >;
}): HistoryRefreshTarget {
  if (selection.historyDetailMode === "turn" && historyViewActive && selection.canToggleTurnView) {
    return "turn";
  }
  if (selection.historyMode === "bookmarks" && selection.selectedProjectId) {
    return "bookmarks";
  }
  if (selection.historyMode === "session" && selection.selectedSessionId) {
    return "session";
  }
  if (selection.historyMode === "project_all" && selection.selectedProjectId) {
    return "project_all";
  }
  return null;
}

export function getAutoRefreshTarget({
  historyViewActive,
  selection,
  projectFingerprintChanged,
  sessionFingerprintChanged,
}: {
  historyViewActive: boolean;
  selection: Pick<
    HistoryRefreshSelectionState,
    | "historyMode"
    | "historyDetailMode"
    | "selectedProjectId"
    | "selectedSessionId"
    | "turnVisualizationSelection"
    | "canToggleTurnView"
  >;
  projectFingerprintChanged: boolean;
  sessionFingerprintChanged: boolean;
}): HistoryRefreshTarget {
  if (
    historyViewActive &&
    selection.historyDetailMode === "turn" &&
    selection.canToggleTurnView &&
    (selection.turnVisualizationSelection.mode === "session"
      ? sessionFingerprintChanged && Boolean(selection.turnVisualizationSelection.sessionId)
      : projectFingerprintChanged && Boolean(selection.turnVisualizationSelection.projectId))
  ) {
    return "turn";
  }
  if (
    selection.historyMode === "bookmarks" &&
    historyViewActive &&
    Boolean(selection.selectedProjectId)
  ) {
    return "bookmarks";
  }
  if (
    historyViewActive &&
    selection.historyMode === "session" &&
    sessionFingerprintChanged &&
    Boolean(selection.selectedSessionId)
  ) {
    return "session";
  }
  if (
    historyViewActive &&
    selection.historyMode === "project_all" &&
    projectFingerprintChanged &&
    Boolean(selection.selectedProjectId)
  ) {
    return "project_all";
  }
  return null;
}

export function shouldRefreshTreeSessions({
  historyViewActive,
  selection,
  treeProjectSessionsByProjectId,
}: {
  historyViewActive: boolean;
  selection: Pick<HistoryRefreshSelectionState, "projectViewMode">;
  treeProjectSessionsByProjectId: Record<string, SessionSummary[]>;
}): boolean {
  return (
    historyViewActive &&
    selection.projectViewMode === "tree" &&
    Object.keys(treeProjectSessionsByProjectId).length > 0
  );
}
