// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectPane } from "./ProjectPane";

const projects = [
  {
    id: "project_1",
    provider: "claude" as const,
    name: "Project One",
    path: "/Users/test/project-one",
    sessionCount: 2,
    lastActivity: "2026-03-01T12:00:00.000Z",
  },
  {
    id: "project_2",
    provider: "codex" as const,
    name: "Project Two",
    path: "/Users/test/project-two",
    sessionCount: 1,
    lastActivity: "2026-03-01T13:00:00.000Z",
  },
];

describe("ProjectPane", () => {
  it("renders projects and dispatches interactions", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
    });

    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();
    const onToggleSortDirection = vi.fn();
    const onProjectQueryChange = vi.fn();
    const onToggleProvider = vi.fn();
    const onSelectProject = vi.fn();
    const onCopyProjectDetails = vi.fn();
    const onOpenProjectLocation = vi.fn();

    render(
      <ProjectPane
        sortedProjects={projects}
        selectedProjectId="project_1"
        sortDirection="desc"
        collapsed={false}
        projectQueryInput=""
        projectProviders={["claude", "codex"]}
        providers={["claude", "codex", "gemini", "cursor"]}
        projectProviderCounts={{ claude: 1, codex: 1, gemini: 0, cursor: 0 }}
        onToggleCollapsed={onToggleCollapsed}
        onProjectQueryChange={onProjectQueryChange}
        onToggleProvider={onToggleProvider}
        onToggleSortDirection={onToggleSortDirection}
        onCopyProjectDetails={onCopyProjectDetails}
        onSelectProject={onSelectProject}
        onOpenProjectLocation={onOpenProjectLocation}
        canCopyProjectDetails={true}
        canOpenProjectLocation={true}
      />,
    );

    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getByText("Project Two")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse Projects pane" }));
    await user.click(screen.getByRole("button", { name: "Sort projects ascending" }));
    await user.click(screen.getByRole("button", { name: "Copy project details" }));
    await user.click(screen.getByRole("button", { name: "Open project folder" }));
    await user.type(screen.getByPlaceholderText("Filter projects..."), "abc");
    await user.click(screen.getByRole("button", { name: /Gemini/i }));
    await user.click(screen.getByRole("button", { name: /Project Two/i }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onToggleSortDirection).toHaveBeenCalledTimes(1);
    expect(onProjectQueryChange).toHaveBeenCalled();
    expect(onToggleProvider).toHaveBeenCalledWith("gemini");
    expect(onSelectProject).toHaveBeenCalledWith("project_2");
    expect(onCopyProjectDetails).toHaveBeenCalledTimes(1);
    expect(onOpenProjectLocation).toHaveBeenCalledTimes(1);
  });

  it("hides sort and open-location actions when collapsed", () => {
    render(
      <ProjectPane
        sortedProjects={projects}
        selectedProjectId=""
        sortDirection="asc"
        collapsed={true}
        projectQueryInput=""
        projectProviders={["claude"]}
        providers={["claude", "codex", "gemini", "cursor"]}
        projectProviderCounts={{ claude: 1, codex: 1, gemini: 0, cursor: 0 }}
        onToggleCollapsed={vi.fn()}
        onProjectQueryChange={vi.fn()}
        onToggleProvider={vi.fn()}
        onToggleSortDirection={vi.fn()}
        onCopyProjectDetails={vi.fn()}
        onSelectProject={vi.fn()}
        onOpenProjectLocation={vi.fn()}
        canCopyProjectDetails={false}
        canOpenProjectLocation={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand Projects pane" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort projects descending" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy project details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open project folder" })).toBeNull();
  });
});
