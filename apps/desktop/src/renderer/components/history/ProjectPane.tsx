import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectSummary, SessionSummary } from "../../app/types";
import { getProjectGroupId } from "../../lib/projectTree";
import { SEARCH_PLACEHOLDERS } from "../../lib/searchLabels";
import { compactPath, deriveSessionTitle, formatDate, prettyProvider } from "../../lib/viewUtils";
import { ToolbarIcon } from "../ToolbarIcon";
import { HistoryListContextMenu } from "./HistoryListContextMenu";
import type { ProjectPaneContextMenuState, ProjectPaneProps } from "./ProjectPane.types";
import { ProjectPaneHeader } from "./ProjectPaneHeader";
import { ProjectPaneChevron, ProjectPaneFolderIcon } from "./ProjectPaneIcons";
import { useProjectPaneTreeState } from "./useProjectPaneTreeState";

function getProjectLabel(project: ProjectSummary): string {
  return project.name || project.path || "(no project path)";
}

function isTreeRowActionTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest(".project-tree-toggle-btn, .project-tree-bookmark-btn"))
  );
}

function OverflowAwareLabel({
  text,
  className,
  innerClassName,
}: {
  text: string;
  className: string;
  innerClassName?: string;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [showTitle, setShowTitle] = useState(false);
  const updateOverflowState = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    setShowTitle(element.scrollWidth > element.clientWidth + 1);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    updateOverflowState();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateOverflowState();
          })
        : null;
    resizeObserver?.observe(element);
    window.addEventListener("resize", updateOverflowState);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflowState);
    };
  }, [updateOverflowState]);

  useEffect(() => {
    void text;
    updateOverflowState();
  }, [text, updateOverflowState]);

  if (innerClassName) {
    return (
      <span ref={containerRef} className={className}>
        <span className={innerClassName} title={showTitle ? text : undefined}>
          {text}
        </span>
      </span>
    );
  }

  return (
    <span ref={containerRef} className={className} title={showTitle ? text : undefined}>
      {text}
    </span>
  );
}

export function ProjectPane({
  data,
  sorting,
  preferences,
  capabilities,
  actions,
}: ProjectPaneProps) {
  const {
    sortedProjects,
    selectedProjectId,
    selectedSessionId = "",
    viewMode,
    updateSource,
    historyMode = "project_all",
    collapsed,
    projectQueryInput,
    projectProviders,
    providers,
    projectProviderCounts,
    projectUpdates,
    treeProjectSessionsByProjectId = {},
    treeProjectSessionsLoadingByProjectId = {},
    listRef,
  } = data;
  const { sortField, sortDirection, sessionSortDirection = "desc" } = sorting;
  const { singleClickFoldersExpand = true, singleClickProjectsExpand = false } = preferences;
  const { canCopyProjectDetails, canOpenProjectLocation, canDeleteProject } = capabilities;
  const {
    onToggleCollapsed,
    onProjectQueryChange,
    onToggleProvider,
    onSetSortField,
    onToggleSortDirection,
    onToggleSessionSortDirection = () => {},
    onToggleViewMode,
    onToggleSingleClickFoldersExpand,
    onToggleSingleClickProjectsExpand,
    onCopyProjectDetails,
    onCopySession,
    onSelectProject,
    onSelectProjectSession = () => {},
    onSelectProjectBookmarks = () => {},
    consumeFocusSelectionBehavior = () => ({ commitMode: "immediate", waitForKeyboardIdle: false }),
    onQueueProjectTreeNoopCommit = () => {},
    onEnsureTreeProjectSessionsLoaded = () => {},
    onOpenProjectLocation,
    onOpenSessionLocation,
    onDeleteProject,
    onDeleteSession,
  } = actions;
  const selectedProjectRef = useRef<HTMLButtonElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ProjectPaneContextMenuState>(null);
  const projectProviderKey = useMemo(() => projectProviders.join(","), [projectProviders]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    selectedProjectRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedProjectId]);
  const {
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder: toggleFolder,
    handleToggleAllFolders: toggleAllFolders,
    handleToggleProjectExpansion: toggleProjectExpansion,
  } = useProjectPaneTreeState({
    sortedProjects,
    selectedProjectId,
    selectedSessionId,
    sortField,
    sortDirection,
    viewMode,
    updateSource,
    historyMode,
    projectProvidersKey: projectProviderKey,
    projectQueryInput,
    onEnsureTreeProjectSessionsLoaded,
  });

  const handleToggleFolder = (folderId: string) => {
    setContextMenu(null);
    toggleFolder(folderId);
  };

  const handleToggleAllFolders = () => {
    setContextMenu(null);
    toggleAllFolders();
  };

  const handleToggleProjectExpansion = (projectId: string) => {
    setContextMenu(null);
    toggleProjectExpansion(projectId);
  };

  const getFolderUpdateDelta = (projects: ProjectSummary[]): number =>
    projects.reduce((total, project) => total + (projectUpdates[project.id]?.messageDelta ?? 0), 0);

  const handleProjectFocusSelection = (projectId: string) => {
    const selectionOptions = consumeFocusSelectionBehavior();
    if (selectionOptions.commitMode === "immediate" && !selectionOptions.waitForKeyboardIdle) {
      onSelectProject(projectId);
      return;
    }
    onSelectProject(projectId, selectionOptions);
  };

  const handleSessionFocusSelection = (projectId: string, sessionId: string) => {
    const selectionOptions = consumeFocusSelectionBehavior();
    if (selectionOptions.commitMode === "immediate" && !selectionOptions.waitForKeyboardIdle) {
      onSelectProjectSession(projectId, sessionId);
      return;
    }
    onSelectProjectSession(projectId, sessionId, selectionOptions);
  };

  const handleFolderFocusSelection = () => {
    onQueueProjectTreeNoopCommit(consumeFocusSelectionBehavior());
  };

  const renderFlatProjectRow = (project: ProjectSummary) => {
    const update = projectUpdates[project.id];
    const projectLabel = getProjectLabel(project);
    return (
      <button
        key={project.id}
        type="button"
        data-project-nav-kind="project"
        data-project-nav-id={project.id}
        ref={project.id === selectedProjectId ? selectedProjectRef : null}
        className={`list-item project-item${project.id === selectedProjectId ? " active" : ""}${
          update ? " recently-updated" : ""
        }`}
        onFocus={() => handleProjectFocusSelection(project.id)}
        onClick={() => {
          setContextMenu(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelectProject(project.id);
          setContextMenu({
            kind: "project",
            projectId: project.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <div className="list-item-name">
          {project.id === selectedProjectId ? <span className="active-dot" /> : null}
          <OverflowAwareLabel text={projectLabel} className="project-item-label" />
          <span
            className={`project-update-badge${update ? " visible" : ""}`}
            aria-label={update ? `${update.messageDelta} new messages` : undefined}
          >
            {update ? `+${update.messageDelta}` : "+0"}
          </span>
        </div>
        <div className="list-item-path">{compactPath(project.path)}</div>
        <div className="list-item-meta">
          <span className={`meta-tag ${project.provider}`}>{prettyProvider(project.provider)}</span>{" "}
          <span className="sessions-count">
            {project.sessionCount} {project.sessionCount === 1 ? "session" : "sessions"}
          </span>
          <span className="dot-sep" />
          <span>{formatDate(project.lastActivity)}</span>
        </div>
      </button>
    );
  };

  const renderTreeSessionRow = (project: ProjectSummary, session: SessionSummary) => {
    const isActive = treeFocusedRow?.kind === "session" && treeFocusedRow.id === session.id;
    const sessionTitle = deriveSessionTitle(session);
    return (
      <button
        key={session.id}
        type="button"
        data-project-nav-kind="session"
        data-session-id={session.id}
        data-project-id={project.id}
        className={`project-tree-session-row${isActive ? " active" : ""}`}
        onFocus={() => {
          setTreeFocusedRow({ kind: "session", id: session.id, projectId: project.id });
          handleSessionFocusSelection(project.id, session.id);
        }}
        onClick={() => {
          setContextMenu(null);
          setTreeFocusedRow({ kind: "session", id: session.id, projectId: project.id });
          onSelectProjectSession(project.id, session.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setTreeFocusedRow({ kind: "session", id: session.id, projectId: project.id });
          onSelectProjectSession(project.id, session.id);
          setContextMenu({
            kind: "session",
            projectId: project.id,
            sessionId: session.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft") {
            return;
          }
          event.preventDefault();
          const projectRow = document.querySelector<HTMLElement>(
            `[data-project-nav-kind="project"][data-project-nav-id="${CSS.escape(project.id)}"]`,
          );
          projectRow?.focus();
        }}
      >
        <span className="project-tree-session-title">{sessionTitle}</span>
        <span className="project-tree-session-count">{session.messageCount} msgs</span>
      </button>
    );
  };

  const renderTreeProjectRow = (project: ProjectSummary) => {
    const update = projectUpdates[project.id];
    const projectLabel = getProjectLabel(project);
    const isActive = treeFocusedRow?.kind === "project" && treeFocusedRow.id === project.id;
    const hasSessions = project.sessionCount > 0;
    const isExpanded = expandedProjectIds.includes(project.id);
    const projectSessions = treeProjectSessionsByProjectId[project.id] ?? [];
    const isLoadingSessions = treeProjectSessionsLoadingByProjectId[project.id] === true;
    const bookmarkButtonActive = historyMode === "bookmarks" && selectedProjectId === project.id;
    const selectProjectRow = () => {
      setContextMenu(null);
      setTreeFocusedRow({ kind: "project", id: project.id });
      onSelectProject(project.id);
    };
    return (
      <div
        key={project.id}
        className={`project-tree-project-row${update ? " recently-updated" : ""}`}
      >
        <div
          className={`project-tree-project-row-main${isActive ? " active" : ""}`}
          onMouseUp={(event) => {
            if (
              !(event.target instanceof HTMLElement) ||
              event.target.closest(
                ".project-tree-select-btn, .project-tree-toggle-btn, .project-tree-bookmark-btn",
              )
            ) {
              return;
            }
            const row = event.currentTarget.querySelector<HTMLElement>(".project-tree-select-btn");
            row?.focus();
            if (hasSessions && singleClickProjectsExpand) {
              handleToggleProjectExpansion(project.id);
            }
          }}
          onDoubleClick={(event) => {
            if (isTreeRowActionTarget(event.target) || !hasSessions) {
              return;
            }
            handleToggleProjectExpansion(project.id);
            const row = event.currentTarget.querySelector<HTMLElement>(".project-tree-select-btn");
            row?.focus();
          }}
          onContextMenu={(event) => {
            if (isTreeRowActionTarget(event.target)) {
              return;
            }
            event.preventDefault();
            selectProjectRow();
            setContextMenu({
              kind: "project",
              projectId: project.id,
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          {hasSessions ? (
            <button
              type="button"
              className="project-tree-toggle-btn"
              data-project-expand-toggle
              data-project-expand-toggle-for={project.id}
              onClick={(event) => {
                event.stopPropagation();
                handleToggleProjectExpansion(project.id);
              }}
              aria-label={isExpanded ? "Collapse project sessions" : "Expand project sessions"}
              title={isExpanded ? "Collapse project sessions" : "Expand project sessions"}
            >
              <ProjectPaneChevron open={isExpanded} />
            </button>
          ) : (
            <span className="project-tree-toggle-placeholder" aria-hidden />
          )}
          <button
            type="button"
            data-project-nav-kind="project"
            data-project-nav-id={project.id}
            data-parent-folder-id={getProjectGroupId(project)}
            data-project-can-expand={hasSessions}
            aria-expanded={hasSessions ? isExpanded : undefined}
            ref={project.id === selectedProjectId ? selectedProjectRef : null}
            className={`project-tree-select-btn${isActive ? " active" : ""}`}
            onFocus={() => {
              setTreeFocusedRow({ kind: "project", id: project.id });
              handleProjectFocusSelection(project.id);
            }}
            onClick={() => {
              selectProjectRow();
              if (hasSessions && singleClickProjectsExpand) {
                handleToggleProjectExpansion(project.id);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                selectProjectRow();
                if (hasSessions) {
                  handleToggleProjectExpansion(project.id);
                }
                return;
              }
              if (event.key === "ArrowRight" && hasSessions && !isExpanded) {
                event.preventDefault();
                handleToggleProjectExpansion(project.id);
                return;
              }
              if (event.key === "ArrowLeft" && hasSessions && isExpanded) {
                event.preventDefault();
                handleToggleProjectExpansion(project.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelectProject(project.id);
              setContextMenu({
                kind: "project",
                projectId: project.id,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <div className="project-tree-row-main">
              <div className="project-tree-name-group">
                <OverflowAwareLabel text={projectLabel} className="project-tree-name" />
                <span
                  className={`project-update-badge project-tree-update-badge${
                    update ? " visible" : ""
                  }`}
                  aria-label={update ? `${update.messageDelta} new messages` : undefined}
                >
                  {update ? `+${update.messageDelta}` : "+0"}
                </span>
              </div>
            </div>
          </button>
          <div className="project-tree-badge-rail">
            {(project.bookmarkCount ?? 0) > 0 ? (
              <button
                type="button"
                className={`project-tree-bookmark-btn${bookmarkButtonActive ? " active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setTreeFocusedRow({ kind: "project", id: project.id });
                  onSelectProjectBookmarks(project.id);
                }}
                title={
                  bookmarkButtonActive
                    ? `Close ${project.bookmarkCount} bookmarked messages`
                    : `Open ${project.bookmarkCount} bookmarked messages`
                }
                aria-label={
                  bookmarkButtonActive
                    ? `Close ${project.bookmarkCount} bookmarked messages`
                    : `Open ${project.bookmarkCount} bookmarked messages`
                }
              >
                <ToolbarIcon name="bookmark" />
                <span>{project.bookmarkCount}</span>
              </button>
            ) : null}
            <span className={`meta-tag project-tree-provider-badge ${project.provider}`}>
              {prettyProvider(project.provider)}
              <span className="project-tree-provider-count">{project.sessionCount}</span>
            </span>
          </div>
        </div>
        {isExpanded ? (
          <div className="project-tree-session-children">
            {isLoadingSessions ? (
              <div className="project-tree-session-loading">Loading sessions…</div>
            ) : (
              projectSessions.map((session) => renderTreeSessionRow(project, session))
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className={`panel history-focus-pane project-pane${collapsed ? " collapsed" : ""}`}>
      <ProjectPaneHeader
        collapsed={collapsed}
        sortField={sortField}
        sortDirection={sortDirection}
        sessionSortDirection={sessionSortDirection}
        viewMode={viewMode}
        singleClickFoldersExpand={singleClickFoldersExpand}
        singleClickProjectsExpand={singleClickProjectsExpand}
        allVisibleFoldersExpanded={allVisibleFoldersExpanded}
        canCopyProjectDetails={canCopyProjectDetails}
        canOpenProjectLocation={canOpenProjectLocation}
        canDeleteProject={canDeleteProject}
        onToggleCollapsed={onToggleCollapsed}
        onSetSortField={onSetSortField}
        onToggleSortDirection={onToggleSortDirection}
        onToggleSessionSortDirection={onToggleSessionSortDirection}
        onToggleViewMode={onToggleViewMode}
        onToggleAllFolders={handleToggleAllFolders}
        onToggleSingleClickFoldersExpand={onToggleSingleClickFoldersExpand}
        onToggleSingleClickProjectsExpand={onToggleSingleClickProjectsExpand}
        onCopyProjectDetails={() => onCopyProjectDetails()}
        onOpenProjectLocation={() => onOpenProjectLocation()}
        onDeleteProject={() => onDeleteProject()}
      />
      <div className="search-wrapper">
        <div className="search-box">
          <div className="search-input-shell">
            <ToolbarIcon name="search" />
            <input
              className="search-input"
              value={projectQueryInput}
              onChange={(event) => onProjectQueryChange(event.target.value)}
              placeholder={SEARCH_PLACEHOLDERS.sidebarProjects}
            />
          </div>
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
      <div
        className={`list-scroll project-list${viewMode === "tree" ? " project-list-tree" : ""}`}
        ref={listRef}
        tabIndex={-1}
      >
        {viewMode === "list"
          ? sortedProjects.map((project) => renderFlatProjectRow(project))
          : folderGroups.map((group) => {
              const isExpanded = expandedFolderIdSet.has(group.id);
              const folderUpdateDelta = getFolderUpdateDelta(group.projects);
              const isFolderActive =
                treeFocusedRow?.kind === "folder" && treeFocusedRow.id === group.id;
              return (
                <div key={group.id} className="project-folder-group">
                  <button
                    type="button"
                    data-project-nav-kind="folder"
                    data-folder-id={group.id}
                    data-folder-first-project-id={group.projects[0]?.id ?? ""}
                    data-folder-last-project-id={
                      group.projects[group.projects.length - 1]?.id ?? ""
                    }
                    className={`project-folder-row${isFolderActive ? " active" : ""}${
                      folderUpdateDelta > 0 ? " recently-updated" : ""
                    }${isExpanded && folderUpdateDelta > 0 ? " expanded-with-updates" : ""}`}
                    onFocus={() => {
                      handleFolderFocusSelection();
                      setTreeFocusedRow({ kind: "folder", id: group.id });
                    }}
                    onClick={(event) => {
                      // Mouse selection on folders should win immediately over any in-flight
                      // keyboard debounce so we never commit a stale project after a click.
                      onQueueProjectTreeNoopCommit();
                      setTreeFocusedRow({ kind: "folder", id: group.id });
                      if (
                        event.target instanceof HTMLElement &&
                        event.target.closest(".project-folder-toggle-hit")
                      ) {
                        handleToggleFolder(group.id);
                        return;
                      }
                      if (singleClickFoldersExpand) {
                        handleToggleFolder(group.id);
                      }
                    }}
                    onDoubleClick={() => {
                      handleToggleFolder(group.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleToggleFolder(group.id);
                        return;
                      }
                      if (event.key === "ArrowRight" && !isExpanded) {
                        event.preventDefault();
                        handleToggleFolder(group.id);
                        return;
                      }
                      if (event.key === "ArrowLeft" && isExpanded) {
                        event.preventDefault();
                        handleToggleFolder(group.id);
                      }
                    }}
                    aria-expanded={isExpanded}
                    aria-label={`${group.label}, ${group.projectCount} projects`}
                  >
                    <span
                      className="project-folder-chevron project-folder-toggle-hit"
                      data-project-expand-toggle-for={group.id}
                      aria-hidden
                    >
                      <ProjectPaneChevron open={isExpanded} />
                    </span>
                    <span className="project-folder-icon" aria-hidden>
                      <ProjectPaneFolderIcon />
                    </span>
                    <span className="project-folder-main">
                      <OverflowAwareLabel
                        text={group.label}
                        className="project-folder-label"
                        innerClassName="project-folder-label-text"
                      />
                      {folderUpdateDelta > 0 ? (
                        <span
                          className={`project-update-badge project-folder-update-badge visible${
                            isExpanded ? " project-folder-update-badge-muted" : ""
                          }`}
                          aria-label={`${folderUpdateDelta} new messages`}
                        >
                          +{folderUpdateDelta}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="project-folder-children">
                      {group.projects.map((project) => renderTreeProjectRow(project))}
                    </div>
                  ) : null}
                </div>
              );
            })}
      </div>
      <HistoryListContextMenu
        open={Boolean(contextMenu)}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        onClose={() => setContextMenu(null)}
        groups={
          contextMenu?.kind === "project"
            ? [
                [
                  {
                    id: "copy-project",
                    label: "Copy",
                    icon: "copy",
                    onSelect: () => onCopyProjectDetails(contextMenu.projectId),
                  },
                  {
                    id: "open-project-folder",
                    label: "Open Folder",
                    icon: "folderOpen",
                    onSelect: () => onOpenProjectLocation(contextMenu.projectId),
                  },
                ],
                [
                  {
                    id: "delete-project",
                    label: "Delete",
                    icon: "trash",
                    tone: "danger",
                    onSelect: () => onDeleteProject(contextMenu.projectId),
                  },
                ],
              ]
            : contextMenu?.kind === "session"
              ? [
                  [
                    {
                      id: "copy-session",
                      label: "Copy",
                      icon: "copy",
                      onSelect: () => onCopySession(contextMenu.sessionId),
                    },
                    {
                      id: "open-session-folder",
                      label: "Open Folder",
                      icon: "folderOpen",
                      onSelect: () => onOpenSessionLocation(contextMenu.sessionId),
                    },
                  ],
                  [
                    {
                      id: "delete-session",
                      label: "Delete",
                      icon: "trash",
                      tone: "danger",
                      onSelect: () => onDeleteSession(contextMenu.sessionId),
                    },
                  ],
                ]
              : []
        }
      />
    </aside>
  );
}
