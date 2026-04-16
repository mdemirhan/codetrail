import { createHistorySelection } from "../app/historySelection";
import type {
  HistoryDetailMode,
  HistorySelection,
  HistoryVisualization,
  PaneStateSnapshot,
} from "../app/types";

export function deriveHistoryVisualization(
  historyMode: HistorySelection["mode"],
  historyDetailMode: HistoryDetailMode,
): HistoryVisualization {
  if (historyDetailMode === "turn") {
    return "turns";
  }
  if (historyMode === "bookmarks") {
    return "bookmarks";
  }
  return "messages";
}

export function deriveInitialHistoryVisualization(
  initialPaneState: PaneStateSnapshot | null | undefined,
): HistoryVisualization {
  if (initialPaneState?.historyMode || initialPaneState?.historyDetailMode) {
    return deriveHistoryVisualization(
      initialPaneState.historyMode ?? "project_all",
      initialPaneState.historyDetailMode ?? "flat",
    );
  }
  return "messages";
}

export function getHistoryDetailModeForVisualization(
  historyVisualization: HistoryVisualization,
): HistoryDetailMode {
  return historyVisualization === "turns" ? "turn" : "flat";
}

export function getTurnVisualizationSelection(args: {
  selection: HistorySelection;
  selectedProjectId: string;
}): HistorySelection {
  const resolvedProjectId = args.selection.projectId || args.selectedProjectId;

  if (args.selection.mode === "session") {
    return resolvedProjectId
      ? createHistorySelection("session", resolvedProjectId, args.selection.sessionId)
      : args.selection;
  }

  if (args.selection.mode === "project_all") {
    return resolvedProjectId
      ? createHistorySelection("project_all", resolvedProjectId)
      : args.selection;
  }

  if (args.selection.sessionId) {
    return resolvedProjectId
      ? createHistorySelection("session", resolvedProjectId, args.selection.sessionId)
      : args.selection;
  }
  return resolvedProjectId
    ? createHistorySelection("project_all", resolvedProjectId, "")
    : args.selection;
}
