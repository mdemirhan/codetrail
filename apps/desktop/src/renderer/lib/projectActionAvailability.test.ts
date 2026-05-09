import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../app/types";
import type { ProjectPaneTreeFocusedRow } from "../components/history/ProjectPane.types";
import { canActOnSelectedProject } from "./projectActionAvailability";

const selectedProject = {} as ProjectSummary;

describe("canActOnSelectedProject", () => {
  it("requires a selected project", () => {
    expect(
      canActOnSelectedProject({
        selectedProject: null,
        projectViewMode: "list",
        treeFocusedRow: null,
      }),
    ).toBe(false);
  });

  it("allows project actions in list view and on concrete tree rows", () => {
    expect(
      canActOnSelectedProject({
        selectedProject,
        projectViewMode: "list",
        treeFocusedRow: { kind: "folder", id: "folder_1" },
      }),
    ).toBe(true);
    expect(
      canActOnSelectedProject({
        selectedProject,
        projectViewMode: "tree",
        treeFocusedRow: { kind: "project", id: "project_1" },
      }),
    ).toBe(true);
  });

  it("blocks project actions when a tree folder row is focused", () => {
    const folderRow: ProjectPaneTreeFocusedRow = { kind: "folder", id: "folder_1" };

    expect(
      canActOnSelectedProject({
        selectedProject,
        projectViewMode: "tree",
        treeFocusedRow: folderRow,
      }),
    ).toBe(false);
  });
});
