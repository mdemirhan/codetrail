import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../app/types";
import {
  collectProjectMessageDeltas,
  mergeStableProjectOrder,
  resolveProjectRefreshSource,
} from "./projectUpdates";

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

  it("forces a one-time resort for the first auto refresh after startup watch restore", () => {
    expect(resolveProjectRefreshSource("auto", true)).toEqual({
      projectSource: "resort",
      clearStartupWatchResort: true,
    });
  });

  it("keeps later auto refreshes stable after the startup watch resort is consumed", () => {
    expect(resolveProjectRefreshSource("auto", false)).toEqual({
      projectSource: "auto",
      clearStartupWatchResort: false,
    });
  });

  it("clears the pending startup watch resort when a manual refresh already resorted", () => {
    expect(resolveProjectRefreshSource("manual", true)).toEqual({
      projectSource: "resort",
      clearStartupWatchResort: true,
    });
  });

  it("keeps manual refreshes on resort without clearing anything when no startup watch resort is pending", () => {
    expect(resolveProjectRefreshSource("manual", false)).toEqual({
      projectSource: "resort",
      clearStartupWatchResort: false,
    });
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
