import type { Dispatch, SetStateAction } from "react";

import type { IpcRequestInput } from "@codetrail/core/browser";

import type { WatchLiveStatusResponse } from "../app/types";
import { ProjectPane } from "../components/history/ProjectPane";
import { SessionPane } from "../components/history/SessionPane";
import { copyTextToClipboard } from "../lib/clipboard";
import { findSessionSummaryById } from "../lib/historySessionLookup";
import { usePaneFocus } from "../lib/paneFocusController";
import { openInFileManager, openPath } from "../lib/pathActions";
import { canActOnSelectedProject } from "../lib/projectActionAvailability";
import { HistoryDetailPane } from "./HistoryDetailPane";
import { formatProjectDetails, formatSessionDetails } from "./historyCopyFormat";
import type { useHistoryController } from "./useHistoryController";

type HistoryController = ReturnType<typeof useHistoryController>;

function copyProjectDetailsById(
  history: HistoryController,
  logError: (context: string, error: unknown) => void,
  projectId?: string,
): void {
  if (!projectId) {
    void history.handleCopyProjectDetails();
    return;
  }
  const project = history.sortedProjects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return;
  }
  void copyTextToClipboard(formatProjectDetails(project)).then((copied) => {
    if (!copied) {
      logError("Failed copying project details", "Clipboard API unavailable");
    }
  });
}

function copySessionDetailsById(
  history: HistoryController,
  logError: (context: string, error: unknown) => void,
  sessionId?: string,
): void {
  if (!sessionId) {
    void history.handleCopySessionDetails();
    return;
  }
  const session = findSessionSummaryById(
    sessionId,
    history.sortedSessions,
    history.treeProjectSessionsByProjectId,
  );
  if (!session) {
    return;
  }
  const project =
    history.sortedProjects.find((candidate) => candidate.id === session.projectId) ?? null;
  void copyTextToClipboard(
    formatSessionDetails(session, {
      projectLabel: project?.name || project?.path || "(unknown project)",
    }),
  ).then((copied) => {
    if (!copied) {
      logError("Failed copying session details", "Clipboard API unavailable");
    }
  });
}

function openProjectLocationById(
  history: HistoryController,
  logError: (context: string, error: unknown) => void,
  projectId?: string,
): void {
  const targetProjectId = projectId || history.selectedProjectId;
  const project = history.sortedProjects.find((candidate) => candidate.id === targetProjectId);
  if (!project?.path?.trim()) {
    return;
  }
  void openInFileManager(history.sortedProjects, targetProjectId).then((result) => {
    if (!result.ok) {
      logError("Failed opening project location", result.error ?? "Unknown error");
    }
  });
}

function openSessionLocationById(
  history: HistoryController,
  logError: (context: string, error: unknown) => void,
  sessionId?: string,
): void {
  const targetSessionId = sessionId || history.selectedSessionId;
  const session = findSessionSummaryById(
    targetSessionId,
    history.sortedSessions,
    history.treeProjectSessionsByProjectId,
  );
  if (!session?.filePath?.trim()) {
    return;
  }
  void openPath(session.filePath).then((result) => {
    if (!result.ok) {
      logError("Failed opening session location", result.error ?? "Unknown error");
    }
  });
}

export function HistoryLayout({
  history,
  advancedSearchEnabled,
  setAdvancedSearchEnabled,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  applyZoomAction,
  setZoomPercent,
  logError,
  canReindexProject,
  onReindexProject,
  onDeleteProject,
  onDeleteSession,
  liveSessions = [],
  liveRowHasBackground = true,
  recordLiveUiTrace,
}: {
  history: HistoryController;
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
  setZoomPercent: (percent: number) => Promise<void>;
  logError: (context: string, error: unknown) => void;
  canReindexProject: boolean;
  onReindexProject: (projectId?: string) => void;
  onDeleteProject: (projectId?: string) => void;
  onDeleteSession: (sessionId?: string) => void;
  liveSessions?: WatchLiveStatusResponse["sessions"];
  liveRowHasBackground?: boolean;
  recordLiveUiTrace?: (payload: IpcRequestInput<"debug:recordLiveUiTrace">) => void;
}) {
  const paneFocus = usePaneFocus();
  const liveTraceProps = recordLiveUiTrace ? { recordLiveUiTrace } : {};
  const uiSelectedProject =
    history.sortedProjects.find((project) => project.id === history.uiSelectedProjectId) ??
    history.selectedProject;
  const canActOnUiSelectedProject = canActOnSelectedProject({
    selectedProject: uiSelectedProject,
    projectViewMode: history.projectViewMode,
    treeFocusedRow: history.treeFocusedRow,
  });

  return (
    <div
      className={`history-visualization-scope history-visualization-${history.historyVisualization}`}
    >
      <ProjectPane
        data={{
          sortedProjects: history.sortedProjects,
          selectedProjectId: history.uiSelectedProjectId,
          selectedSessionId: history.uiSelectedSessionId,
          listRef: history.refs.projectListRef,
          viewMode: history.projectViewMode,
          updateSource: history.projectListUpdateSource,
          historyMode: history.uiHistoryMode,
          historyVisualization: history.historyVisualization,
          collapsed: history.projectPaneCollapsed,
          projectQueryInput: history.projectQueryInput,
          projectProviders: history.projectProviders,
          providers: history.enabledProviders,
          projectProviderCounts: history.projectProviderCounts,
          projectUpdates: history.projectUpdates,
          treeProjectSessionsByProjectId: history.treeProjectSessionsByProjectId,
          treeProjectSessionsLoadingByProjectId: history.treeProjectSessionsLoadingByProjectId,
          folderGroups: history.folderGroups,
          expandedFolderIdSet: history.expandedFolderIdSet,
          expandedProjectIds: history.expandedProjectIds,
          allVisibleFoldersExpanded: history.allVisibleFoldersExpanded,
          treeFocusedRow: history.treeFocusedRow,
        }}
        sorting={{
          sortField: history.projectSortField,
          sortDirection: history.projectSortDirection,
          sessionSortDirection: history.sessionSortDirection,
        }}
        preferences={{
          hideSessionsPaneInTreeView: history.hideSessionsPaneInTreeView,
          singleClickFoldersExpand: history.singleClickFoldersExpand,
          singleClickProjectsExpand: history.singleClickProjectsExpand,
        }}
        actions={{
          onToggleCollapsed: () => history.setProjectPaneCollapsed((value) => !value),
          onProjectQueryChange: history.setProjectQueryInput,
          onToggleProvider: (provider) =>
            history.setProjectProviders((value) =>
              value.includes(provider)
                ? value.filter((candidate) => candidate !== provider)
                : [...value, provider],
            ),
          onSetSortField: history.setProjectSortField,
          onToggleSortDirection: () =>
            history.setProjectSortDirection((value) => (value === "asc" ? "desc" : "asc")),
          onToggleSessionSortDirection: () =>
            history.setSessionSortDirection((value) => (value === "asc" ? "desc" : "asc")),
          onToggleViewMode: () =>
            history.setProjectViewMode((value) => (value === "list" ? "tree" : "list")),
          onToggleHideSessionsPaneInTreeView: () =>
            history.setHideSessionsPaneInTreeView((value) => !value),
          onToggleSingleClickFoldersExpand: () =>
            history.setSingleClickFoldersExpand((value) => !value),
          onToggleSingleClickProjectsExpand: () =>
            history.setSingleClickProjectsExpand((value) => !value),
          onCopyProjectDetails: (projectId) => copyProjectDetailsById(history, logError, projectId),
          onCopySession: (sessionId) => copySessionDetailsById(history, logError, sessionId),
          onSelectProject: (projectId, options) =>
            history.selectProjectAllMessages(projectId, options),
          onSelectProjectSession: (projectId, sessionId, options) =>
            history.selectSessionView(sessionId, projectId, options),
          onSelectProjectBookmarks: history.openProjectBookmarksView,
          consumeFocusSelectionBehavior: history.consumeProjectPaneFocusSelectionBehavior,
          onQueueProjectTreeNoopCommit: history.queueProjectTreeNoopCommit,
          onSetTreeFocusedRow: history.setTreeFocusedRow,
          onToggleFolder: history.handleToggleFolder,
          onToggleAllFolders: history.handleToggleAllFolders,
          onToggleProjectExpansion: history.handleToggleProjectExpansion,
          onReindexProject,
          onDeleteProject,
          onOpenProjectLocation: (projectId) =>
            openProjectLocationById(history, logError, projectId),
          onOpenSessionLocation: (sessionId) =>
            openSessionLocationById(history, logError, sessionId),
          onDeleteSession,
        }}
        capabilities={{
          canCopyProjectDetails: Boolean(uiSelectedProject),
          canOpenProjectLocation: Boolean(uiSelectedProject?.path?.trim()),
          canReindexProject: canReindexProject && canActOnUiSelectedProject,
          canDeleteProject: canActOnUiSelectedProject,
        }}
      />

      <div
        className={
          history.projectPaneCollapsed ? "pane-resizer pane-resizer-disabled" : "pane-resizer"
        }
        onPointerDown={history.projectPaneCollapsed ? undefined : history.beginResize("project")}
      />

      {history.hideSessionsPaneForTreeView ? null : (
        <>
          <SessionPane
            sortedSessions={history.visibleSessionPaneSessions}
            selectedSessionId={history.uiSelectedSessionId}
            listRef={history.refs.sessionListRef}
            sortDirection={history.sessionSortDirection}
            allSessionsCount={history.visibleSessionPaneAllSessionsCount}
            allSessionsSelected={history.uiHistoryMode === "project_all"}
            bookmarksCount={history.visibleSessionPaneBookmarksCount}
            bookmarksSelected={history.uiHistoryMode === "bookmarks"}
            collapsed={history.sessionPaneCollapsed}
            // Session actions should only operate on committed data, even while the list highlight
            // moves ahead during keyboard debounce.
            canCopySession={history.historyMode === "session" && !!history.selectedSession}
            canOpenSessionLocation={
              history.historyMode === "session" &&
              Boolean(history.selectedSession?.filePath?.trim())
            }
            canDeleteSession={history.historyMode === "session" && !!history.selectedSession}
            onToggleCollapsed={() => history.setSessionPaneCollapsed((value) => !value)}
            onToggleSortDirection={() =>
              history.setSessionSortDirection((value) => (value === "asc" ? "desc" : "asc"))
            }
            onCopySession={(sessionId) => copySessionDetailsById(history, logError, sessionId)}
            onDeleteSession={onDeleteSession}
            onOpenSessionLocation={(sessionId) =>
              openSessionLocationById(history, logError, sessionId)
            }
            onSelectAllSessions={() => {
              history.selectProjectAllMessages(history.selectedProjectId);
            }}
            onSelectBookmarks={history.selectBookmarksView}
            onSelectSession={history.selectSessionView}
            historyVisualization={history.historyVisualization}
          />

          <div
            className={
              history.sessionPaneCollapsed ? "pane-resizer pane-resizer-disabled" : "pane-resizer"
            }
            onPointerDown={
              history.sessionPaneCollapsed ? undefined : history.beginResize("session")
            }
          />
        </>
      )}

      <section
        className={`pane content-pane history-focus-pane history-visualization-${history.historyVisualization}`}
        {...paneFocus.getHistoryPaneRootProps("message")}
        ref={(element) => {
          paneFocus.registerHistoryPaneRoot("message", element);
        }}
      >
        <HistoryDetailPane
          history={history}
          advancedSearchEnabled={advancedSearchEnabled}
          setAdvancedSearchEnabled={setAdvancedSearchEnabled}
          zoomPercent={zoomPercent}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          applyZoomAction={applyZoomAction}
          setZoomPercent={setZoomPercent}
          liveSessions={liveSessions}
          liveRowHasBackground={liveRowHasBackground}
          {...liveTraceProps}
        />
      </section>
    </div>
  );
}
