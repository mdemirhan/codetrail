import { useRef, useState } from "react";

import type { ProjectSortField, ProjectViewMode } from "../../app/types";
import { useClickOutside } from "../../hooks/useClickOutside";
import { formatTooltip } from "../../lib/tooltipText";
import { ToolbarIcon } from "../ToolbarIcon";
import {
  ProjectPaneFolderIcon,
  ProjectPaneListIcon,
  ProjectPaneMenuIcon,
  ProjectPaneSortFieldIcon,
} from "./ProjectPaneIcons";

const PROJECT_SORT_FIELD_LABELS: Record<ProjectSortField, string> = {
  last_active: "Last Active",
  name: "Name",
};

const PROJECT_SORT_COPY: Record<
  ProjectSortField,
  Record<"asc" | "desc", { tooltip: string; ariaLabel: string }>
> = {
  last_active: {
    asc: {
      tooltip: "Oldest first",
      ariaLabel: "Oldest activity first (projects). Switch to newest first",
    },
    desc: {
      tooltip: "Newest first",
      ariaLabel: "Newest activity first (projects). Switch to oldest first",
    },
  },
  name: {
    asc: {
      tooltip: "A to Z",
      ariaLabel: "A to Z (projects). Switch to Z to A",
    },
    desc: {
      tooltip: "Z to A",
      ariaLabel: "Z to A (projects). Switch to A to Z",
    },
  },
};

type ProjectPaneHeaderProps = {
  collapsed: boolean;
  sortField: ProjectSortField;
  sortDirection: "asc" | "desc";
  sessionSortDirection: "asc" | "desc";
  viewMode: ProjectViewMode;
  singleClickFoldersExpand: boolean;
  singleClickProjectsExpand: boolean;
  hideSessionsPaneInTreeView: boolean;
  allVisibleFoldersExpanded: boolean;
  canCopyProjectDetails: boolean;
  canOpenProjectLocation: boolean;
  canDeleteProject: boolean;
  onToggleCollapsed: () => void;
  onSetSortField: (value: ProjectSortField) => void;
  onToggleSortDirection: () => void;
  onToggleSessionSortDirection: () => void;
  onToggleViewMode: () => void;
  onToggleHideSessionsPaneInTreeView: () => void;
  onToggleAllFolders: () => void;
  onToggleSingleClickFoldersExpand: () => void;
  onToggleSingleClickProjectsExpand: () => void;
  onCopyProjectDetails: () => void;
  onOpenProjectLocation: () => void;
  onDeleteProject: () => void;
};

export function ProjectPaneHeader({
  collapsed,
  sortField,
  sortDirection,
  sessionSortDirection,
  viewMode,
  singleClickFoldersExpand,
  singleClickProjectsExpand,
  hideSessionsPaneInTreeView,
  allVisibleFoldersExpanded,
  canCopyProjectDetails,
  canOpenProjectLocation,
  canDeleteProject,
  onToggleCollapsed,
  onSetSortField,
  onToggleSortDirection,
  onToggleSessionSortDirection,
  onToggleViewMode,
  onToggleHideSessionsPaneInTreeView,
  onToggleAllFolders,
  onToggleSingleClickFoldersExpand,
  onToggleSingleClickProjectsExpand,
  onCopyProjectDetails,
  onOpenProjectLocation,
  onDeleteProject,
}: ProjectPaneHeaderProps) {
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);

  useClickOutside(sortMenuRef, sortMenuOpen, () => setSortMenuOpen(false));
  useClickOutside(overflowMenuRef, overflowMenuOpen, () => setOverflowMenuOpen(false));

  const sortLabel = PROJECT_SORT_FIELD_LABELS[sortField];
  const sortCopy = PROJECT_SORT_COPY[sortField][sortDirection];

  return (
    <div className="panel-header">
      <div className="panel-header-left">
        <span className="panel-title">Projects</span>
      </div>
      <div className="pane-head-controls">
        {!collapsed ? (
          <>
            {viewMode === "tree" ? (
              <button
                type="button"
                className="collapse-btn"
                onClick={onToggleAllFolders}
                aria-label={
                  allVisibleFoldersExpanded ? "Collapse all folders" : "Expand all folders"
                }
                title={allVisibleFoldersExpanded ? "Collapse" : "Expand"}
              >
                <ToolbarIcon name={allVisibleFoldersExpanded ? "collapseAll" : "expandAll"} />
              </button>
            ) : null}
            <div className="project-pane-sort-group" ref={sortMenuRef}>
              <button
                type="button"
                className="collapse-btn tb-dropdown-trigger project-pane-sort-field-btn"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                aria-label={`Project sort field: ${sortLabel}`}
                title={`Sort by ${sortLabel}`}
                onClick={() => setSortMenuOpen((value) => !value)}
              >
                <ProjectPaneSortFieldIcon />
              </button>
              <button
                type="button"
                className="collapse-btn project-pane-sort-direction-btn"
                onClick={onToggleSortDirection}
                aria-label={sortCopy.ariaLabel}
                title={sortCopy.tooltip}
              >
                <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
              </button>
              {sortMenuOpen ? (
                <dialog
                  className="tb-dropdown-menu project-pane-header-menu"
                  open
                  aria-label="Project sort field"
                >
                  {(Object.entries(PROJECT_SORT_FIELD_LABELS) as [ProjectSortField, string][]).map(
                    ([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`tb-dropdown-item tb-dropdown-item-checkable${
                          value === sortField ? " selected" : ""
                        }`}
                        onClick={() => {
                          onSetSortField(value);
                          setSortMenuOpen(false);
                        }}
                      >
                        <span>{label}</span>
                        {value === sortField ? <span className="tb-dropdown-check">✓</span> : null}
                      </button>
                    ),
                  )}
                </dialog>
              ) : null}
            </div>
            <button
              type="button"
              className={`collapse-btn project-pane-view-toggle-btn${
                viewMode === "tree" ? " active" : ""
              }`}
              onClick={onToggleViewMode}
              aria-label={viewMode === "list" ? "Switch to By Folder" : "Switch to List"}
              title={viewMode === "list" ? "Switch to Folder view" : "Switch to List view"}
            >
              {viewMode === "list" ? <ProjectPaneListIcon /> : <ProjectPaneFolderIcon />}
            </button>
            <div className="tb-dropdown project-pane-overflow-dropdown" ref={overflowMenuRef}>
              <button
                type="button"
                className="collapse-btn tb-dropdown-trigger"
                onClick={() => setOverflowMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={overflowMenuOpen}
                aria-label="Project options"
                title="Project actions"
              >
                <ProjectPaneMenuIcon />
              </button>
              {overflowMenuOpen ? (
                <dialog
                  className="tb-dropdown-menu tb-dropdown-menu-right project-pane-header-menu project-pane-overflow-menu"
                  open
                  aria-label="Project options"
                >
                  {viewMode === "tree" ? (
                    <>
                      <button
                        type="button"
                        className={`tb-dropdown-item tb-dropdown-item-checkable${
                          hideSessionsPaneInTreeView ? " selected" : ""
                        }`}
                        onClick={() => {
                          onToggleHideSessionsPaneInTreeView();
                          setOverflowMenuOpen(false);
                        }}
                      >
                        <span>Hide Sessions pane in tree view</span>
                        {hideSessionsPaneInTreeView ? (
                          <span className="tb-dropdown-check">✓</span>
                        ) : null}
                      </button>
                      <div className="tb-dropdown-separator" />
                      <button
                        type="button"
                        className={`tb-dropdown-item tb-dropdown-item-checkable${
                          singleClickFoldersExpand ? " selected" : ""
                        }`}
                        onClick={() => {
                          onToggleSingleClickFoldersExpand();
                          setOverflowMenuOpen(false);
                        }}
                      >
                        <span>Single-click folders to expand or collapse</span>
                        {singleClickFoldersExpand ? (
                          <span className="tb-dropdown-check">✓</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className={`tb-dropdown-item tb-dropdown-item-checkable${
                          singleClickProjectsExpand ? " selected" : ""
                        }`}
                        onClick={() => {
                          onToggleSingleClickProjectsExpand();
                          setOverflowMenuOpen(false);
                        }}
                      >
                        <span>Single-click projects to expand or collapse</span>
                        {singleClickProjectsExpand ? (
                          <span className="tb-dropdown-check">✓</span>
                        ) : null}
                      </button>
                      <div className="tb-dropdown-separator" />
                      <button
                        type="button"
                        className="tb-dropdown-item project-pane-overflow-item"
                        onClick={() => {
                          onToggleSessionSortDirection();
                          setOverflowMenuOpen(false);
                        }}
                      >
                        <span className="project-pane-overflow-icon" aria-hidden>
                          <ToolbarIcon
                            name={sessionSortDirection === "asc" ? "sortAsc" : "sortDesc"}
                          />
                        </span>
                        <span>
                          {sessionSortDirection === "asc"
                            ? "Sessions: oldest first"
                            : "Sessions: newest first"}
                        </span>
                      </button>
                      <div className="tb-dropdown-separator" />
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="tb-dropdown-item project-pane-overflow-item"
                    onClick={() => {
                      onCopyProjectDetails();
                      setOverflowMenuOpen(false);
                    }}
                    disabled={!canCopyProjectDetails}
                  >
                    <span className="project-pane-overflow-icon" aria-hidden>
                      <ToolbarIcon name="copy" />
                    </span>
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    className="tb-dropdown-item project-pane-overflow-item"
                    onClick={() => {
                      onOpenProjectLocation();
                      setOverflowMenuOpen(false);
                    }}
                    disabled={!canOpenProjectLocation}
                  >
                    <span className="project-pane-overflow-icon" aria-hidden>
                      <ToolbarIcon name="folderOpen" />
                    </span>
                    <span>Open Folder</span>
                  </button>
                  <div className="tb-dropdown-separator" />
                  <button
                    type="button"
                    className="tb-dropdown-item project-pane-overflow-item project-pane-overflow-item-danger"
                    onClick={() => {
                      onDeleteProject();
                      setOverflowMenuOpen(false);
                    }}
                    disabled={!canDeleteProject}
                  >
                    <span className="project-pane-overflow-icon" aria-hidden>
                      <ToolbarIcon name="trash" />
                    </span>
                    <span>Delete</span>
                  </button>
                </dialog>
              ) : null}
            </div>
          </>
        ) : null}
        <button
          type="button"
          className="collapse-btn pane-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand Projects pane" : "Collapse Projects pane"}
          title={formatTooltip(collapsed ? "Expand Projects" : "Collapse Projects", "Cmd+B")}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
      </div>
    </div>
  );
}
