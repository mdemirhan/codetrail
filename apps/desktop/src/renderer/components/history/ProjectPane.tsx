import type { IpcResponse, Provider } from "@codetrail/core";
import { useEffect, useRef } from "react";

import { compactPath, formatDate, prettyProvider } from "../../lib/viewUtils";
import { ToolbarIcon } from "../ToolbarIcon";

type ProjectSummary = IpcResponse<"projects:list">["projects"][number];

export function ProjectPane({
  sortedProjects,
  selectedProjectId,
  projectQueryInput,
  projectProviders,
  providers,
  projectProviderCounts,
  onProjectQueryChange,
  onToggleProvider,
  onSelectProject,
  onOpenProjectLocation,
  canOpenSessionLocation,
  onOpenSessionLocation,
}: {
  sortedProjects: ProjectSummary[];
  selectedProjectId: string;
  projectQueryInput: string;
  projectProviders: Provider[];
  providers: Provider[];
  projectProviderCounts: Record<Provider, number>;
  onProjectQueryChange: (value: string) => void;
  onToggleProvider: (provider: Provider) => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectLocation: () => void;
  canOpenSessionLocation: boolean;
  onOpenSessionLocation: () => void;
}) {
  const selectedProjectRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    selectedProjectRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedProjectId]);

  return (
    <aside className="panel project-pane">
      <div className="panel-header">
        <span className="panel-title">Projects</span>
        <div className="pane-head-controls">
          <span className="panel-count">{sortedProjects.length}</span>
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
      <div className="panel-footer">
        <button
          type="button"
          className="footer-btn"
          onClick={onOpenProjectLocation}
          disabled={!selectedProjectId}
        >
          Open Project Location
        </button>
        <button
          type="button"
          className="footer-btn"
          onClick={onOpenSessionLocation}
          disabled={!canOpenSessionLocation}
        >
          Open Session Location
        </button>
      </div>
    </aside>
  );
}
