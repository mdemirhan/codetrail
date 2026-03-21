import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../app/types";
import { collectProjectMessageDeltas, mergeStableProjectOrder } from "./projectUpdates";

describe("projectUpdates", () => {
  it("collects positive project message deltas", () => {
    const previousProjects: ProjectSummary[] = [
      createProject({ id: "project_1", messageCount: 10 }),
      createProject({ id: "project_2", messageCount: 5 }),
    ];
    const nextProjects: ProjectSummary[] = [
      createProject({ id: "project_1", messageCount: 13 }),
      createProject({ id: "project_2", messageCount: 5 }),
      createProject({ id: "project_3", messageCount: 2 }),
    ];

    expect(collectProjectMessageDeltas(previousProjects, nextProjects)).toEqual({
      project_1: 3,
    });
  });

  it("preserves the existing order and appends new ids", () => {
    expect(
      mergeStableProjectOrder(
        ["project_3", "project_1", "project_2"],
        ["project_2", "project_1", "project_4"],
      ),
    ).toEqual(["project_1", "project_2", "project_4"]);
  });
});

function createProject(
  overrides: Partial<ProjectSummary> & Pick<ProjectSummary, "id">,
): ProjectSummary {
  const { id, ...rest } = overrides;
  return {
    id,
    provider: "claude",
    name: id,
    path: `/tmp/${id}`,
    sessionCount: 1,
    messageCount: 0,
    bookmarkCount: 0,
    lastActivity: null,
    ...rest,
  };
}
