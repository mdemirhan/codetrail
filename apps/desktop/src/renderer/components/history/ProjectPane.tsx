import type { IpcResponse, Provider } from "@codetrail/core";

import { compactPath, formatDate, prettyProvider } from "../../lib/viewUtils";

type ProjectSortMode = "recent" | "name" | "provider";
type ProjectSummary = IpcResponse<"projects:list">["projects"][number];

export function ProjectPane({
  sortedProjects,
  selectedProjectId,
  projectSortMode,
  projectQueryInput,
  projectProviders,
  providers,
  projectProviderCounts,
  onProjectSortChange,
  onProjectQueryChange,
  onToggleProvider,
  onSelectProject,
  onOpenProjectLocation,
}: {
  sortedProjects: ProjectSummary[];
  selectedProjectId: string;
  projectSortMode: ProjectSortMode;
  projectQueryInput: string;
  projectProviders: Provider[];
  providers: Provider[];
  projectProviderCounts: Record<Provider, number>;
  onProjectSortChange: (mode: ProjectSortMode) => void;
  onProjectQueryChange: (value: string) => void;
  onToggleProvider: (provider: Provider) => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectLocation: () => void;
}) {
  return (
    <aside className="pane project-pane">
      <div className="pane-head">
        <h2>Projects</h2>
        <div className="pane-head-controls">
          <span>{sortedProjects.length}</span>
          <select
            value={projectSortMode}
            onChange={(event) => onProjectSortChange(event.target.value as ProjectSortMode)}
          >
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="provider">Provider</option>
          </select>
        </div>
      </div>
      <input
        value={projectQueryInput}
        onChange={(event) => onProjectQueryChange(event.target.value)}
        placeholder="Filter projects"
      />
      <div className="chip-row">
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            className={`chip provider-chip provider-${provider}${
              projectProviders.includes(provider) ? " active" : ""
            }`}
            onClick={() => onToggleProvider(provider)}
          >
            {prettyProvider(provider)} ({projectProviderCounts[provider]})
          </button>
        ))}
      </div>
      <div className="project-list">
        {sortedProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={project.id === selectedProjectId ? "list-item active" : "list-item"}
            onClick={() => onSelectProject(project.id)}
          >
            <div className="item-title-row">
              <span>{project.name || project.path || "(no project path)"}</span>
              <small className="path-inline">{compactPath(project.path)}</small>
            </div>
            <small>
              <span className={`provider-label provider-${project.provider}`}>
                {prettyProvider(project.provider)}
              </span>{" "}
              |{" "}
              <span className="meta-count">
                {project.sessionCount} {project.sessionCount === 1 ? "session" : "sessions"}
              </span>{" "}
              | {formatDate(project.lastActivity)}
            </small>
          </button>
        ))}
      </div>
      {selectedProjectId ? (
        <button type="button" className="context-action" onClick={onOpenProjectLocation}>
          Open Project Location
        </button>
      ) : null}
    </aside>
  );
}
