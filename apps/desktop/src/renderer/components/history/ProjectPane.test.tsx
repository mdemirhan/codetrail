// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { useMemo } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProjectSummary, SessionSummary, TreeAutoRevealSessionRequest } from "../../app/types";
import { SEARCH_PLACEHOLDERS } from "../../lib/searchLabels";
import { ProjectPane } from "./ProjectPane";
import { useProjectPaneTreeState } from "./useProjectPaneTreeState";

type ProjectPaneOverrides = {
  data?: Partial<ComponentProps<typeof ProjectPane>["data"]> & {
    autoRevealSessionRequest?: TreeAutoRevealSessionRequest | null;
  };
  sorting?: Partial<ComponentProps<typeof ProjectPane>["sorting"]>;
  preferences?: Partial<ComponentProps<typeof ProjectPane>["preferences"]>;
  capabilities?: Partial<ComponentProps<typeof ProjectPane>["capabilities"]>;
  actions?: Partial<ComponentProps<typeof ProjectPane>["actions"]> & {
    onEnsureTreeProjectSessionsLoaded?: (projectId: string) => void;
    onConsumeAutoRevealSessionRequest?: () => void;
  };
};

function createProjectSummary(
  overrides: Partial<ProjectSummary> & Pick<ProjectSummary, "id" | "provider" | "name" | "path">,
): ProjectSummary {
  const { id, provider, name, path, ...rest } = overrides;
  return {
    id,
    provider,
    name,
    path,
    providerProjectKey: null,
    repositoryUrl: null,
    resolutionState: null,
    resolutionSource: null,
    sessionCount: 1,
    messageCount: 0,
    bookmarkCount: 0,
    lastActivity: null,
    ...rest,
  };
}

function createSessionSummary(
  overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "projectId">,
): SessionSummary {
  const { id, projectId, ...rest } = overrides;
  return {
    id,
    projectId,
    provider: "claude",
    filePath: `/tmp/${id}.jsonl`,
    title: id,
    modelNames: "claude-opus",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:00:05.000Z",
    durationMs: 5000,
    gitBranch: "main",
    cwd: "/workspace",
    sessionIdentity: null,
    providerSessionId: null,
    sessionKind: null,
    canonicalProjectPath: null,
    repositoryUrl: null,
    gitCommitHash: null,
    lineageParentId: null,
    providerClient: null,
    providerSource: null,
    providerClientVersion: null,
    resolutionSource: null,
    worktreeLabel: null,
    worktreeSource: null,
    messageCount: 0,
    bookmarkCount: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    ...rest,
  };
}

const projects: ProjectSummary[] = [
  createProjectSummary({
    id: "project_1",
    provider: "claude",
    name: "Project One",
    path: "/Users/test/project-one",
    sessionCount: 2,
    messageCount: 12,
    lastActivity: "2026-03-01T12:00:00.000Z",
  }),
  createProjectSummary({
    id: "project_2",
    provider: "codex",
    name: "Project Two",
    path: "/Users/test/project-two",
    sessionCount: 1,
    messageCount: 6,
    lastActivity: "2026-03-01T13:00:00.000Z",
  }),
  createProjectSummary({
    id: "project_3",
    provider: "gemini",
    name: "Project Three",
    path: "/tmp/project-three",
    sessionCount: 7,
    messageCount: 22,
    lastActivity: "2026-03-01T10:00:00.000Z",
  }),
];

function createProjectPaneProps(
  overrides: ProjectPaneOverrides = {},
): ComponentProps<typeof ProjectPane> {
  const { autoRevealSessionRequest: _autoRevealSessionRequest, ...dataOverrides } =
    overrides.data ?? {};
  const {
    onEnsureTreeProjectSessionsLoaded: _onEnsureTreeProjectSessionsLoaded,
    onConsumeAutoRevealSessionRequest: _onConsumeAutoRevealSessionRequest,
    ...actionOverrides
  } = overrides.actions ?? {};
  const data: ComponentProps<typeof ProjectPane>["data"] = {
    sortedProjects: projects,
    selectedProjectId: "project_1",
    viewMode: "list" as const,
    updateSource: "resort" as const,
    collapsed: false,
    projectQueryInput: "",
    projectProviders: ["claude", "codex", "gemini"],
    providers: ["claude", "codex", "gemini", "cursor"],
    projectProviderCounts: { claude: 1, codex: 1, gemini: 1, cursor: 0, copilot: 0 },
    projectUpdates: { project_2: { messageDelta: 3, updatedAt: Date.now() } },
  };
  const sorting: ComponentProps<typeof ProjectPane>["sorting"] = {
    sortField: "last_active" as const,
    sortDirection: "desc" as const,
  };
  const preferences: ComponentProps<typeof ProjectPane>["preferences"] = {
    singleClickFoldersExpand: true,
    singleClickProjectsExpand: false,
  };
  const capabilities: ComponentProps<typeof ProjectPane>["capabilities"] = {
    canCopyProjectDetails: true,
    canDeleteProject: true,
    canOpenProjectLocation: true,
  };
  const actions: ComponentProps<typeof ProjectPane>["actions"] = {
    onToggleCollapsed: vi.fn(),
    onProjectQueryChange: vi.fn(),
    onToggleProvider: vi.fn(),
    onSetSortField: vi.fn(),
    onToggleSortDirection: vi.fn(),
    onToggleViewMode: vi.fn(),
    onToggleHideSessionsPaneInTreeView: vi.fn(),
    onToggleSingleClickFoldersExpand: vi.fn(),
    onToggleSingleClickProjectsExpand: vi.fn(),
    onCopyProjectDetails: vi.fn(),
    onCopySession: vi.fn(),
    onSelectProject: vi.fn(),
    onOpenProjectLocation: vi.fn(),
    onOpenSessionLocation: vi.fn(),
    onDeleteProject: vi.fn(),
    onDeleteSession: vi.fn(),
  };

  return {
    data: { ...data, ...dataOverrides },
    sorting: { ...sorting, ...overrides.sorting },
    preferences: { ...preferences, ...overrides.preferences },
    capabilities: { ...capabilities, ...overrides.capabilities },
    actions: { ...actions, ...actionOverrides },
  };
}

function ProjectPaneHarness({ overrides }: { overrides?: ProjectPaneOverrides }) {
  const props = useMemo(() => createProjectPaneProps(overrides), [overrides]);
  const treeState = useProjectPaneTreeState({
    sortedProjects: props.data.sortedProjects,
    selectedProjectId: props.data.selectedProjectId,
    selectedSessionId: props.data.selectedSessionId ?? "",
    sortField: props.sorting.sortField,
    sortDirection: props.sorting.sortDirection,
    viewMode: props.data.viewMode,
    updateSource: props.data.updateSource,
    historyMode: props.data.historyMode ?? "project_all",
    projectProvidersKey: props.data.projectProviders.join(","),
    projectQueryInput: props.data.projectQueryInput,
    onEnsureTreeProjectSessionsLoaded:
      overrides?.actions?.onEnsureTreeProjectSessionsLoaded ?? vi.fn(),
    autoRevealSessionRequest: overrides?.data?.autoRevealSessionRequest ?? null,
    onConsumeAutoRevealSessionRequest:
      overrides?.actions?.onConsumeAutoRevealSessionRequest ?? vi.fn(),
  });

  return (
    <ProjectPane
      {...props}
      data={{
        ...props.data,
        folderGroups: treeState.folderGroups,
        expandedFolderIdSet: treeState.expandedFolderIdSet,
        expandedProjectIds: treeState.expandedProjectIds,
        allVisibleFoldersExpanded: treeState.allVisibleFoldersExpanded,
        treeFocusedRow: treeState.treeFocusedRow,
      }}
      actions={{
        ...props.actions,
        onSetTreeFocusedRow: treeState.setTreeFocusedRow,
        onToggleFolder: treeState.handleToggleFolder,
        onToggleAllFolders: treeState.handleToggleAllFolders,
        onToggleProjectExpansion: treeState.handleToggleProjectExpansion,
      }}
    />
  );
}

function renderProjectPane(overrides: ProjectPaneOverrides = {}) {
  return render(<ProjectPaneHarness overrides={overrides} />);
}

describe("ProjectPane", () => {
  it("does not create a ResizeObserver per label", () => {
    const resizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));
    Object.defineProperty(window, "ResizeObserver", {
      value: resizeObserver,
      configurable: true,
    });

    renderProjectPane();

    expect(resizeObserver).not.toHaveBeenCalled();
  });

  it("renders projects and dispatches list interactions through the new toolbar", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
    });

    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();
    const onSetSortField = vi.fn();
    const onToggleSortDirection = vi.fn();
    const onToggleViewMode = vi.fn();
    const onToggleHideSessionsPaneInTreeView = vi.fn();
    const onProjectQueryChange = vi.fn();
    const onToggleProvider = vi.fn();
    const onSelectProject = vi.fn();
    const onCopyProjectDetails = vi.fn();
    const onOpenProjectLocation = vi.fn();

    renderProjectPane({
      actions: {
        onToggleCollapsed,
        onSetSortField,
        onToggleSortDirection,
        onToggleViewMode,
        onToggleHideSessionsPaneInTreeView,
        onProjectQueryChange,
        onToggleProvider,
        onSelectProject,
        onCopyProjectDetails,
        onOpenProjectLocation,
      },
    });

    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getByText("Project Two")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Projects pane" })).toHaveAttribute(
      "title",
      "Collapse Projects  ⌘B",
    );

    await user.click(screen.getByRole("button", { name: "Collapse Projects pane" }));
    await user.click(screen.getByRole("button", { name: "Project sort field: Last Active" }));
    await user.click(screen.getByRole("button", { name: "Name" }));
    await user.click(
      screen.getByRole("button", {
        name: "Newest activity first (projects). Switch to oldest first",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("button", { name: "Switch to By Folder" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.sidebarProjects), "abc");
    await user.click(screen.getAllByRole("button", { name: /Gemini/i })[0]!);
    await user.click(screen.getByRole("button", { name: /Project Two/i }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onSetSortField).toHaveBeenCalledWith("name");
    expect(onToggleSortDirection).toHaveBeenCalledTimes(1);
    expect(onToggleViewMode).toHaveBeenCalledTimes(1);
    expect(onToggleHideSessionsPaneInTreeView).not.toHaveBeenCalled();
    expect(onProjectQueryChange).toHaveBeenCalled();
    expect(onToggleProvider).toHaveBeenCalledWith("gemini");
    expect(onSelectProject).toHaveBeenCalledWith("project_2");
    expect(onCopyProjectDetails).toHaveBeenCalledTimes(1);
    expect(onOpenProjectLocation).not.toHaveBeenCalled();
  });

  it("hides sort and overflow actions when collapsed", () => {
    renderProjectPane({
      data: {
        collapsed: true,
        selectedProjectId: "",
        projectProviders: ["claude"],
      },
      sorting: {
        sortDirection: "asc",
      },
      capabilities: {
        canCopyProjectDetails: false,
        canDeleteProject: false,
        canOpenProjectLocation: false,
      },
    });

    expect(screen.getByRole("button", { name: "Expand Projects pane" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Projects pane" })).toHaveAttribute(
      "title",
      "Expand Projects  ⌘B",
    );
    expect(screen.queryByRole("button", { name: "Project sort field: Last Active" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Newest activity first (projects). Switch to oldest first",
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Switch to By Folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Project options" })).toBeNull();
  });

  it("routes Enter, Escape, and Tab from the project search box into the project list", () => {
    const { container } = renderProjectPane();
    const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.sidebarProjects);
    const projectList = container.querySelector<HTMLDivElement>(".list-scroll.project-list");

    expect(projectList).not.toBeNull();
    if (!projectList) {
      throw new Error("Expected project list");
    }

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(document.activeElement).toBe(projectList);

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(document.activeElement).toBe(projectList);

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "Tab" });
    expect(document.activeElement).toBe(projectList);
  });

  it("shows a single expand-or-collapse-all control only in tree view", async () => {
    const user = userEvent.setup();

    const { rerender } = renderProjectPane({
      data: {
        viewMode: "tree",
      },
    });

    expect(screen.getByRole("button", { name: "Collapse all folders" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse all folders" }));

    expect(screen.getByRole("button", { name: "Expand all folders" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Project One/i })).toBeNull();

    rerender(<ProjectPaneHarness overrides={{ data: { viewMode: "list" } }} />);

    expect(screen.queryByRole("button", { name: "Expand all folders" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse all folders" })).toBeNull();
  });

  it("offers a tree-view toggle to hide the Sessions pane from the project overflow menu", async () => {
    const user = userEvent.setup();
    const onToggleHideSessionsPaneInTreeView = vi.fn();

    renderProjectPane({
      data: {
        viewMode: "tree",
      },
      actions: {
        onToggleHideSessionsPaneInTreeView,
      },
    });

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(screen.getByRole("button", { name: "Hide Sessions pane in tree view" }));

    expect(onToggleHideSessionsPaneInTreeView).toHaveBeenCalledTimes(1);
  });

  it("resets seen folders when switching away from tree view and back", async () => {
    const { rerender } = renderProjectPane({
      data: {
        viewMode: "tree",
      },
    });

    fireEvent.keyDown(screen.getByRole("button", { name: /~\/project-one, 1 projects/i }), {
      key: "Enter",
    });
    expect(screen.queryByRole("button", { name: /Project One/i })).toBeNull();

    rerender(<ProjectPaneHarness overrides={{ data: { viewMode: "list", projectUpdates: {} } }} />);

    rerender(<ProjectPaneHarness overrides={{ data: { viewMode: "tree", projectUpdates: {} } }} />);

    expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
  });

  it("keeps a collapsed project collapsed when session mode selects one of its sessions", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
    });

    renderProjectPane({
      data: {
        viewMode: "tree",
        historyMode: "session",
        selectedProjectId: "project_1",
        selectedSessionId: "session_2",
        treeProjectSessionsByProjectId: {
          project_1: [
            createSessionSummary({
              id: "session_1",
              projectId: "project_1",
              filePath: "/tmp/session-1.jsonl",
              title: "Session One",
              messageCount: 3,
              tokenInputTotal: 10,
              tokenOutputTotal: 8,
            }),
            createSessionSummary({
              id: "session_2",
              projectId: "project_1",
              filePath: "/tmp/session-2.jsonl",
              title: "Session Two",
              startedAt: "2026-03-01T11:00:00.000Z",
              endedAt: "2026-03-01T11:00:05.000Z",
              messageCount: 4,
              tokenInputTotal: 12,
              tokenOutputTotal: 9,
            }),
          ],
        },
      },
      actions: {
        onEnsureTreeProjectSessionsLoaded: vi.fn(),
      },
    });

    expect(screen.queryByRole("button", { name: /Session Two/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
  });

  it("reveals and scrolls the selected session when its project is already expanded", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });

    const { rerender } = renderProjectPane({
      data: {
        viewMode: "tree",
        historyMode: "project_all",
        selectedProjectId: "project_1",
        treeProjectSessionsByProjectId: {
          project_1: [
            createSessionSummary({
              id: "session_1",
              projectId: "project_1",
              filePath: "/tmp/session-1.jsonl",
              title: "Session One",
              messageCount: 3,
              tokenInputTotal: 10,
              tokenOutputTotal: 8,
            }),
            createSessionSummary({
              id: "session_2",
              projectId: "project_1",
              filePath: "/tmp/session-2.jsonl",
              title: "Session Two",
              startedAt: "2026-03-01T11:00:00.000Z",
              endedAt: "2026-03-01T11:00:05.000Z",
              messageCount: 4,
              tokenInputTotal: 12,
              tokenOutputTotal: 9,
            }),
          ],
        },
      },
      actions: {
        onEnsureTreeProjectSessionsLoaded: vi.fn(),
      },
    });

    const expandProjectOneButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_1"]',
    );
    if (!expandProjectOneButton) {
      throw new Error("Expected expand toggle for project_1");
    }

    await user.click(expandProjectOneButton);
    scrollIntoView.mockClear();

    rerender(
      <ProjectPaneHarness
        overrides={{
          data: {
            selectedSessionId: "session_2",
            viewMode: "tree",
            historyMode: "session",
            projectUpdates: {},
            treeProjectSessionsByProjectId: {
              project_1: [
                createSessionSummary({
                  id: "session_1",
                  projectId: "project_1",
                  filePath: "/tmp/session-1.jsonl",
                  title: "Session One",
                  messageCount: 3,
                  tokenInputTotal: 10,
                  tokenOutputTotal: 8,
                }),
                createSessionSummary({
                  id: "session_2",
                  projectId: "project_1",
                  filePath: "/tmp/session-2.jsonl",
                  title: "Session Two",
                  startedAt: "2026-03-01T11:00:00.000Z",
                  endedAt: "2026-03-01T11:00:05.000Z",
                  messageCount: 4,
                  tokenInputTotal: 12,
                  tokenOutputTotal: 9,
                }),
              ],
            },
          },
          actions: {
            onToggleSessionSortDirection: vi.fn(),
            onSelectProjectSession: vi.fn(),
            onSelectProjectBookmarks: vi.fn(),
            onEnsureTreeProjectSessionsLoaded: vi.fn(),
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /Session Two/i })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("auto-expands and reveals a session only for explicit tree reveal requests", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });
    const onEnsureTreeProjectSessionsLoaded = vi.fn();
    const onConsumeAutoRevealSessionRequest = vi.fn();

    renderProjectPane({
      data: {
        viewMode: "tree",
        historyMode: "project_all",
        selectedProjectId: "project_1",
        autoRevealSessionRequest: {
          projectId: "project_1",
          sessionId: "session_2",
        },
        treeProjectSessionsByProjectId: {
          project_1: [
            createSessionSummary({
              id: "session_1",
              projectId: "project_1",
              filePath: "/tmp/session-1.jsonl",
              title: "Session One",
              messageCount: 3,
              tokenInputTotal: 10,
              tokenOutputTotal: 8,
            }),
            createSessionSummary({
              id: "session_2",
              projectId: "project_1",
              filePath: "/tmp/session-2.jsonl",
              title: "Session Two",
              startedAt: "2026-03-01T11:00:00.000Z",
              endedAt: "2026-03-01T11:00:05.000Z",
              messageCount: 4,
              tokenInputTotal: 12,
              tokenOutputTotal: 9,
            }),
          ],
        },
      },
      actions: {
        onEnsureTreeProjectSessionsLoaded,
        onConsumeAutoRevealSessionRequest,
      },
    });

    expect(await screen.findByRole("button", { name: /Session Two/i })).toBeInTheDocument();
    expect(onEnsureTreeProjectSessionsLoaded).toHaveBeenCalledWith("project_1");
    expect(onConsumeAutoRevealSessionRequest).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("opens a project context menu with grouped actions for the clicked row", async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    const onOpenProjectLocation = vi.fn();

    renderProjectPane({
      actions: {
        onSelectProject,
        onOpenProjectLocation,
      },
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /Project Two/i }));

    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open Folder" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Open Folder" }));

    expect(onSelectProject).toHaveBeenCalledWith("project_2");
    expect(onOpenProjectLocation).toHaveBeenCalledWith("project_2");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("renders compact folder groups in tree mode and only toggles folders on root click", async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();

    renderProjectPane({
      data: {
        viewMode: "tree",
      },
      actions: {
        onSelectProject,
      },
    });

    expect(screen.getByRole("button", { name: "~/project-one, 1 projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "~/project-two, 1 projects" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "/tmp/project-three, 1 projects" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Today 1:00 PM")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Collapse all folders" }));
    await user.click(screen.getByRole("button", { name: "~/project-one, 1 projects" }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Project One/i }));

    expect(onSelectProject).toHaveBeenCalledWith("project_1");
  });

  it("queues a no-op debounced tree navigation step when a folder row receives focus", () => {
    const onQueueProjectTreeNoopCommit = vi.fn();
    const consumeFocusSelectionBehavior = vi.fn(() => ({
      commitMode: "debounced_project" as const,
      waitForKeyboardIdle: true,
    }));

    renderProjectPane({
      data: {
        viewMode: "tree",
      },
      actions: {
        onQueueProjectTreeNoopCommit,
        consumeFocusSelectionBehavior,
      },
    });

    fireEvent.focus(screen.getByRole("button", { name: "~/project-one, 1 projects" }));

    expect(consumeFocusSelectionBehavior).toHaveBeenCalledTimes(1);
    expect(onQueueProjectTreeNoopCommit).toHaveBeenCalledWith({
      commitMode: "debounced_project",
      waitForKeyboardIdle: true,
    });
  });

  it("lets the overflow toggles control single-click expansion behavior", async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    const onToggleSingleClickFoldersExpand = vi.fn();
    const onToggleSingleClickProjectsExpand = vi.fn();

    const { rerender } = renderProjectPane({
      data: {
        viewMode: "tree",
      },
      actions: {
        onSelectProject,
        onToggleSingleClickFoldersExpand,
        onToggleSingleClickProjectsExpand,
      },
    });

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(
      screen.getByRole("button", { name: /Single-click folders to expand or collapse/i }),
    );
    expect(onToggleSingleClickFoldersExpand).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Project options" }));
    await user.click(
      screen.getByRole("button", { name: /Single-click projects to expand or collapse/i }),
    );
    expect(onToggleSingleClickProjectsExpand).toHaveBeenCalledTimes(1);

    rerender(
      <ProjectPaneHarness
        overrides={{
          data: {
            viewMode: "tree",
            historyMode: "project_all",
            treeProjectSessionsByProjectId: {},
            treeProjectSessionsLoadingByProjectId: {},
            projectUpdates: {},
          },
          preferences: {
            singleClickFoldersExpand: false,
            singleClickProjectsExpand: true,
          },
          actions: {
            onSelectProject,
            onSelectProjectSession: vi.fn(),
            onSelectProjectBookmarks: vi.fn(),
            onEnsureTreeProjectSessionsLoaded: vi.fn(),
            onToggleCollapsed: vi.fn(),
            onProjectQueryChange: vi.fn(),
            onToggleProvider: vi.fn(),
            onSetSortField: vi.fn(),
            onToggleSortDirection: vi.fn(),
            onToggleSessionSortDirection: vi.fn(),
            onToggleViewMode: vi.fn(),
            onToggleSingleClickFoldersExpand: vi.fn(),
            onToggleSingleClickProjectsExpand: vi.fn(),
            onCopyProjectDetails: vi.fn(),
            onCopySession: vi.fn(),
            onOpenProjectLocation: vi.fn(),
            onOpenSessionLocation: vi.fn(),
            onDeleteProject: vi.fn(),
            onDeleteSession: vi.fn(),
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse all folders" }));
    await user.click(screen.getByRole("button", { name: "~/project-one, 1 projects" }));
    expect(screen.queryByRole("button", { name: /Project One/i })).toBeNull();

    rerender(
      <ProjectPaneHarness
        overrides={{
          data: {
            viewMode: "tree",
            historyMode: "project_all",
            treeProjectSessionsByProjectId: {},
            treeProjectSessionsLoadingByProjectId: {},
            projectUpdates: {},
          },
          preferences: {
            singleClickFoldersExpand: true,
            singleClickProjectsExpand: true,
          },
          actions: {
            onSelectProject,
            onSelectProjectSession: vi.fn(),
            onSelectProjectBookmarks: vi.fn(),
            onEnsureTreeProjectSessionsLoaded: vi.fn(),
            onToggleCollapsed: vi.fn(),
            onProjectQueryChange: vi.fn(),
            onToggleProvider: vi.fn(),
            onSetSortField: vi.fn(),
            onToggleSortDirection: vi.fn(),
            onToggleSessionSortDirection: vi.fn(),
            onToggleViewMode: vi.fn(),
            onToggleSingleClickFoldersExpand: vi.fn(),
            onToggleSingleClickProjectsExpand: vi.fn(),
            onCopyProjectDetails: vi.fn(),
            onCopySession: vi.fn(),
            onOpenProjectLocation: vi.fn(),
            onOpenSessionLocation: vi.fn(),
            onDeleteProject: vi.fn(),
            onDeleteSession: vi.fn(),
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "~/project-one, 1 projects" }));
    await user.click(screen.getByRole("button", { name: /Project One/i }));

    expect(onSelectProject).toHaveBeenCalledWith("project_1");
    expect(screen.getByRole("button", { name: /Project One/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps project-row click separate from project expansion and exposes bookmarks inline", async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    const onSelectProjectBookmarks = vi.fn();
    const onSelectProjectSession = vi.fn();
    const onEnsureTreeProjectSessionsLoaded = vi.fn();

    renderProjectPane({
      data: {
        viewMode: "tree",
        historyMode: "project_all",
        sortedProjects: [{ ...projects[0]!, bookmarkCount: 3 }],
        treeProjectSessionsByProjectId: {
          project_1: [
            createSessionSummary({
              id: "session_1",
              projectId: "project_1",
              filePath: "/Users/test/project-one/session.jsonl",
              title: "Investigate markdown rendering",
              modelNames: "claude-opus-4-1",
              startedAt: "2026-03-01T10:00:00.000Z",
              endedAt: "2026-03-01T10:05:00.000Z",
              durationMs: 300000,
              gitBranch: "main",
              cwd: "/Users/test/project-one",
              messageCount: 12,
              bookmarkCount: 2,
              tokenInputTotal: 10,
              tokenOutputTotal: 20,
            }),
          ],
        },
      },
      actions: {
        onSelectProject,
        onSelectProjectBookmarks,
        onSelectProjectSession,
        onEnsureTreeProjectSessionsLoaded,
      },
    });

    await user.click(screen.getByRole("button", { name: /project one/i }));
    expect(onSelectProject).toHaveBeenCalledWith("project_1");
    expect(screen.queryByText("Investigate markdown rendering")).toBeNull();

    const expandProjectOneButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_1"]',
    );
    if (!expandProjectOneButton) {
      throw new Error("Expected expand toggle for project_1");
    }

    await user.click(expandProjectOneButton);
    expect(onEnsureTreeProjectSessionsLoaded).toHaveBeenCalledWith("project_1");
    expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open 3 bookmarked messages" }));
    expect(onSelectProjectBookmarks).toHaveBeenCalledWith("project_1");

    await user.click(screen.getByRole("button", { name: /Investigate markdown rendering/i }));
    expect(onSelectProjectSession).toHaveBeenCalledWith("project_1", "session_1");
  });

  it("moves ArrowLeft from a tree session row back to its parent project row", async () => {
    const user = userEvent.setup();

    renderProjectPane({
      data: {
        viewMode: "tree",
        historyMode: "project_all",
        sortedProjects: [projects[0]!],
        treeProjectSessionsByProjectId: {
          project_1: [
            createSessionSummary({
              id: "session_1",
              projectId: "project_1",
              filePath: "/Users/test/project-one/session.jsonl",
              title: "Investigate markdown rendering",
              modelNames: "claude-opus-4-1",
              startedAt: "2026-03-01T10:00:00.000Z",
              endedAt: "2026-03-01T10:05:00.000Z",
              durationMs: 300000,
              gitBranch: "main",
              cwd: "/Users/test/project-one",
              messageCount: 12,
              bookmarkCount: 2,
              tokenInputTotal: 10,
              tokenOutputTotal: 20,
            }),
          ],
        },
      },
      actions: {
        onSelectProjectSession: vi.fn(),
        onEnsureTreeProjectSessionsLoaded: vi.fn(),
      },
    });

    await user.dblClick(screen.getByRole("button", { name: /project one/i }));

    const sessionRow = screen.getByRole("button", { name: /Investigate markdown rendering/i });
    const projectRow = screen.getByRole("button", { name: /project one/i });

    fireEvent.focus(sessionRow);
    await user.keyboard("{ArrowLeft}");

    expect(projectRow).toHaveFocus();
  });

  it("hides empty roots in tree mode when the visible project set is filtered", () => {
    renderProjectPane({
      data: {
        viewMode: "tree",
        sortedProjects: [projects[2]!],
        projectQueryInput: "three",
      },
    });

    expect(
      screen.getByRole("button", { name: "/tmp/project-three, 1 projects" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "~/project-one, 1 projects" })).toBeNull();
  });

  it("keeps folder ordering stable during auto refresh while showing child update badges", () => {
    const { rerender } = renderProjectPane({
      data: {
        viewMode: "tree",
        updateSource: "resort",
        sortedProjects: [projects[1]!, projects[0]!, projects[2]!],
      },
    });

    const projectTwoFolder = screen.getByRole("button", { name: "~/project-two, 1 projects" });
    const projectThreeFolder = screen.getByRole("button", {
      name: "/tmp/project-three, 1 projects",
    });
    expect(
      projectTwoFolder.compareDocumentPosition(projectThreeFolder) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    rerender(
      <ProjectPaneHarness
        overrides={{
          data: {
            sortedProjects: [projects[2]!, projects[0]!, projects[1]!],
            selectedProjectId: "project_1",
            viewMode: "tree",
            updateSource: "auto",
            projectUpdates: { project_3: { messageDelta: 4, updatedAt: Date.now() } },
          },
          actions: {
            onToggleCollapsed: vi.fn(),
            onProjectQueryChange: vi.fn(),
            onToggleProvider: vi.fn(),
            onSetSortField: vi.fn(),
            onToggleSortDirection: vi.fn(),
            onToggleViewMode: vi.fn(),
            onToggleSingleClickFoldersExpand: vi.fn(),
            onToggleSingleClickProjectsExpand: vi.fn(),
            onCopyProjectDetails: vi.fn(),
            onCopySession: vi.fn(),
            onSelectProject: vi.fn(),
            onOpenProjectLocation: vi.fn(),
            onOpenSessionLocation: vi.fn(),
            onDeleteProject: vi.fn(),
            onDeleteSession: vi.fn(),
          },
        }}
      />,
    );

    const reorderedProjectTwoFolder = screen.getByRole("button", {
      name: "~/project-two, 1 projects",
    });
    const reorderedProjectThreeFolder = screen.getByRole("button", {
      name: "/tmp/project-three, 1 projects",
    });
    expect(
      reorderedProjectTwoFolder.compareDocumentPosition(reorderedProjectThreeFolder) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getAllByText("+4")).toHaveLength(2);
  });

  it("keeps the root-level update indicator visible after a folder expands", async () => {
    const user = userEvent.setup();
    const { rerender } = renderProjectPane({
      data: {
        viewMode: "tree",
        sortedProjects: [projects[0]!, projects[1]!],
        projectUpdates: {},
      },
    });

    await user.click(screen.getByRole("button", { name: "~/project-one, 1 projects" }));

    rerender(
      <ProjectPaneHarness
        overrides={{
          data: {
            sortedProjects: [projects[0]!, projects[1]!],
            selectedProjectId: "",
            viewMode: "tree",
            updateSource: "auto",
            projectProviderCounts: { claude: 1, codex: 1, gemini: 0, cursor: 0, copilot: 0 },
            projectUpdates: { project_1: { messageDelta: 5, updatedAt: Date.now() } },
          },
          actions: {
            onToggleCollapsed: vi.fn(),
            onProjectQueryChange: vi.fn(),
            onToggleProvider: vi.fn(),
            onSetSortField: vi.fn(),
            onToggleSortDirection: vi.fn(),
            onToggleViewMode: vi.fn(),
            onToggleSingleClickFoldersExpand: vi.fn(),
            onToggleSingleClickProjectsExpand: vi.fn(),
            onCopyProjectDetails: vi.fn(),
            onCopySession: vi.fn(),
            onSelectProject: vi.fn(),
            onOpenProjectLocation: vi.fn(),
            onOpenSessionLocation: vi.fn(),
            onDeleteProject: vi.fn(),
            onDeleteSession: vi.fn(),
          },
        }}
      />,
    );

    const expandedRoot = screen.getByRole("button", { name: "~/project-one, 1 projects" });
    expect(expandedRoot).toHaveTextContent("+5");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "~/project-one, 1 projects" }));
    expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
    expect(screen.getAllByLabelText("5 new messages")).toHaveLength(2);
  });
});
