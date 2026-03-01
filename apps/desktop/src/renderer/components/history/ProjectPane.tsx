import type { IpcResponse, Provider } from "@codetrail/core";
import { useEffect, useRef } from "react";

import { compactPath, formatDate, prettyProvider } from "../../lib/viewUtils";
import { ToolbarIcon } from "../ToolbarIcon";

type ProjectSummary = IpcResponse<"projects:list">["projects"][number];

export function ProjectPane({
  sortedProjects,
  selectedProjectId,
  sortDirection,
  collapsed,
  projectQueryInput,
  projectProviders,
  providers,
  projectProviderCounts,
  onToggleCollapsed,
  onProjectQueryChange,
  onToggleProvider,
  onToggleSortDirection,
  onCopyProjectDetails,
  onSelectProject,
  onOpenProjectLocation,
  canCopyProjectDetails,
  canOpenProjectLocation,
}: {
  sortedProjects: ProjectSummary[];
  selectedProjectId: string;
  sortDirection: "asc" | "desc";
  collapsed: boolean;
  projectQueryInput: string;
  projectProviders: Provider[];
  providers: Provider[];
  projectProviderCounts: Record<Provider, number>;
  onToggleCollapsed: () => void;
  onProjectQueryChange: (value: string) => void;
  onToggleProvider: (provider: Provider) => void;
  onToggleSortDirection: () => void;
  onCopyProjectDetails: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectLocation: () => void;
  canCopyProjectDetails: boolean;
  canOpenProjectLocation: boolean;
}) {
  const selectedProjectRef = useRef<HTMLButtonElement | null>(null);
  const sortTooltip =
    sortDirection === "asc"
      ? "Projects: oldest activity first. Click to show newest activity first."
      : "Projects: newest activity first. Click to show oldest activity first.";

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    selectedProjectRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedProjectId]);

  return (
    <aside className={`panel project-pane${collapsed ? " collapsed" : ""}`}>
      <div className="panel-header">
        <div className="panel-header-left">
          <span className="panel-title">Projects</span>
          <span className="panel-count">{sortedProjects.length}</span>
        </div>
        <div className="pane-head-controls">
          {!collapsed ? (
            <>
              <button
                type="button"
                className="collapse-btn sort-btn"
                onClick={onToggleSortDirection}
                aria-label={
                  sortDirection === "asc"
                    ? "Sort projects descending"
                    : "Sort projects ascending"
                }
                title={sortTooltip}
              >
                <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
              </button>
              <button
                type="button"
                className="collapse-btn"
                onClick={onCopyProjectDetails}
                aria-label="Copy project details"
                title="Copy project details"
                disabled={!canCopyProjectDetails}
              >
                <ToolbarIcon name="copy" />
              </button>
              <button
                type="button"
                className="collapse-btn pane-open-location-btn"
                onClick={onOpenProjectLocation}
                aria-label="Open project folder"
                title="Open project folder"
                disabled={!canOpenProjectLocation}
              >
                <ToolbarIcon name="folderOpen" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="collapse-btn pane-collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand Projects pane" : "Collapse Projects pane"}
            title={collapsed ? "Expand Projects" : "Collapse Projects"}
          >
            <ToolbarIcon name="chevronLeft" />
          </button>
        </div>
      </div>
      <div className="search-wrapper">
        <div className="search-box">
          <ToolbarIcon name="search" />
          <input
            className="search-input"
            value={projectQueryInput}
            onChange={(event) => onProjectQueryChange(event.target.value)}
            placeholder="Filter projects..."
          />
        </div>
      </div>
      <div className="tag-row">
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            className={`tag tag-${provider}${projectProviders.includes(provider) ? " active" : ""}`}
            onClick={() => onToggleProvider(provider)}
          >
            {prettyProvider(provider)}
            <span className="count">{projectProviderCounts[provider]}</span>
          </button>
        ))}
      </div>
      <div className="list-scroll project-list">
        {sortedProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            ref={project.id === selectedProjectId ? selectedProjectRef : null}
            className={
              project.id === selectedProjectId
                ? "list-item project-item active"
                : "list-item project-item"
            }
            onClick={() => onSelectProject(project.id)}
          >
            <div className="list-item-name">
              {project.id === selectedProjectId ? <span className="active-dot" /> : null}
              {project.name || project.path || "(no project path)"}
            </div>
            <div className="list-item-path">{compactPath(project.path)}</div>
            <div className="list-item-meta">
              <span className={`meta-tag ${project.provider}`}>
                {prettyProvider(project.provider)}
              </span>{" "}
              <span className="sessions-count">
                {project.sessionCount} {project.sessionCount === 1 ? "session" : "sessions"}
              </span>
              <span className="dot-sep" />
              <span>{formatDate(project.lastActivity)}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
