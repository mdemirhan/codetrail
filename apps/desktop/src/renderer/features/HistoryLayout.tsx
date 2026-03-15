import type { Dispatch, SetStateAction } from "react";

import { PROVIDERS } from "../app/constants";
import { ProjectPane } from "../components/history/ProjectPane";
import { SessionPane } from "../components/history/SessionPane";
import { openInFileManager, openPath } from "../lib/pathActions";
import { HistoryDetailPane } from "./HistoryDetailPane";
import type { useHistoryController } from "./useHistoryController";

type HistoryController = ReturnType<typeof useHistoryController>;

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
}) {
  return (
    <>
      <ProjectPane
        sortedProjects={history.sortedProjects}
        selectedProjectId={history.selectedProjectId}
        listRef={history.refs.projectListRef}
        sortDirection={history.projectSortDirection}
        collapsed={history.projectPaneCollapsed}
        projectQueryInput={history.projectQueryInput}
        projectProviders={history.projectProviders}
        providers={PROVIDERS}
        projectProviderCounts={history.projectProviderCounts}
        onToggleCollapsed={() => history.setProjectPaneCollapsed((value) => !value)}
        onProjectQueryChange={history.setProjectQueryInput}
        onToggleProvider={(provider) =>
          history.setProjectProviders((value) => {
            const next = value.includes(provider)
              ? value.filter((candidate) => candidate !== provider)
              : [...value, provider];
            return next;
          })
        }
        onToggleSortDirection={() =>
          history.setProjectSortDirection((value) => (value === "asc" ? "desc" : "asc"))
        }
        onCopyProjectDetails={() => void history.handleCopyProjectDetails()}
        onSelectProject={history.selectProjectAllMessages}
        onOpenProjectLocation={() => {
          if (!history.selectedProject?.path?.trim()) {
            return;
          }
          void openInFileManager(history.sortedProjects, history.selectedProjectId).then(
            (result) => {
              if (!result.ok) {
                logError("Failed opening project location", result.error ?? "Unknown error");
              }
            },
          );
        }}
        canCopyProjectDetails={Boolean(history.selectedProject)}
        canOpenProjectLocation={Boolean(history.selectedProject?.path?.trim())}
      />

      <div className="pane-resizer" onPointerDown={history.beginResize("project")} />

      <SessionPane
        sortedSessions={history.visibleSessionPaneSessions}
        selectedSessionId={history.selectedSessionId}
        listRef={history.refs.sessionListRef}
        sortDirection={history.sessionSortDirection}
        allSessionsCount={history.visibleSessionPaneAllSessionsCount}
        allSessionsSelected={history.historyMode === "project_all"}
        bookmarksCount={history.visibleSessionPaneBookmarksCount}
        bookmarksSelected={history.historyMode === "bookmarks"}
        collapsed={history.sessionPaneCollapsed}
        canCopySession={history.historyMode === "session" && !!history.selectedSession}
        canOpenSessionLocation={
          history.historyMode === "session" && Boolean(history.selectedSession?.filePath?.trim())
        }
        onToggleCollapsed={() => history.setSessionPaneCollapsed((value) => !value)}
        onToggleSortDirection={() =>
          history.setSessionSortDirection((value) => (value === "asc" ? "desc" : "asc"))
        }
        onCopySession={() => void history.handleCopySessionDetails()}
        onOpenSessionLocation={() => {
          if (!history.selectedSession?.filePath?.trim()) {
            return;
          }
          void openPath(history.selectedSession.filePath).then((result) => {
            if (!result.ok) {
              logError("Failed opening session location", result.error ?? "Unknown error");
            }
          });
        }}
        onSelectAllSessions={() => {
          history.selectProjectAllMessages(history.selectedProjectId);
        }}
        onSelectBookmarks={history.selectBookmarksView}
        onSelectSession={history.selectSessionView}
      />

      <div className="pane-resizer" onPointerDown={history.beginResize("session")} />

      <section className="pane content-pane history-focus-pane">
        <HistoryDetailPane
          history={history}
          advancedSearchEnabled={advancedSearchEnabled}
          setAdvancedSearchEnabled={setAdvancedSearchEnabled}
          zoomPercent={zoomPercent}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          applyZoomAction={applyZoomAction}
          setZoomPercent={setZoomPercent}
        />
      </section>
    </>
  );
}
