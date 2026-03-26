import type { ProjectViewMode } from "../app/types";

export function isSessionsPaneVisible({
  sessionPaneCollapsed,
  projectViewMode,
  hideSessionsPaneForTreeView,
}: {
  sessionPaneCollapsed: boolean;
  projectViewMode: ProjectViewMode;
  hideSessionsPaneForTreeView: boolean;
}): boolean {
  return !sessionPaneCollapsed && !(projectViewMode === "tree" && hideSessionsPaneForTreeView);
}
