import type { PaneStateSnapshot } from "./types";
import type { HistorySelection, HistorySelectionMode } from "./types";

export function createHistorySelection(
  mode: HistorySelectionMode,
  projectId: string,
  sessionId = "",
): HistorySelection {
  if (mode === "session") {
    return {
      mode,
      projectId,
      sessionId,
    };
  }
  return {
    mode,
    projectId,
  };
}

export function createHistorySelectionFromPaneState(
  paneState: PaneStateSnapshot | null | undefined,
): HistorySelection {
  return createHistorySelection(
    paneState?.historyMode ?? "project_all",
    paneState?.selectedProjectId ?? "",
    paneState?.selectedSessionId ?? "",
  );
}

export function setHistorySelectionProjectId(
  selection: HistorySelection,
  projectId: string,
): HistorySelection {
  if (selection.mode === "session") {
    return {
      mode: "session",
      projectId,
      sessionId: selection.sessionId,
    };
  }
  return {
    ...selection,
    projectId,
  };
}

export function setHistorySelectionSessionId(
  selection: HistorySelection,
  sessionId: string,
): HistorySelection {
  return {
    mode: "session",
    projectId: selection.projectId,
    sessionId,
  };
}
