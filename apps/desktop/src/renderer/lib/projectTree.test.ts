import { describe, expect, it } from "vitest";

import { buildProjectFolderGroups } from "./projectTree";

const projects = [
  {
    id: "project_1",
    provider: "claude" as const,
    name: "Alpha",
    path: "/Users/test/src/alpha",
    sessionCount: 2,
    messageCount: 12,
    bookmarkCount: 0,
    lastActivity: "2026-03-01T12:00:00.000Z",
  },
  {
    id: "project_2",
    provider: "codex" as const,
    name: "Beta",
    path: "/Users/test/src/beta",
    sessionCount: 9,
    messageCount: 36,
    bookmarkCount: 0,
    lastActivity: "2026-03-01T13:00:00.000Z",
  },
  {
    id: "project_3",
    provider: "gemini" as const,
    name: "Gamma",
    path: "/tmp/gamma",
    sessionCount: 3,
    messageCount: 14,
    bookmarkCount: 0,
    lastActivity: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "project_4",
    provider: "claude" as const,
    name: "Loose",
    path: "",
    sessionCount: 1,
    messageCount: 2,
    bookmarkCount: 0,
    lastActivity: null,
  },
];

describe("buildProjectFolderGroups", () => {
  it("groups projects by project folder and uses home-relative labels when possible", () => {
    const groups = buildProjectFolderGroups(projects, "last_active", "desc");

    expect(groups.map((group) => group.label)).toEqual([
      "~/src/beta",
      "~/src/alpha",
      "/tmp/gamma",
      "Other Locations",
    ]);
    expect(groups[0]?.projects.map((project) => project.id)).toEqual(["project_2"]);
  });

  it("sorts folder groups by label using the selected direction in name mode", () => {
    const ascending = buildProjectFolderGroups(projects, "name", "asc");
    const descending = buildProjectFolderGroups(projects, "name", "desc");

    expect(ascending.map((group) => group.label)).toEqual([
      "/tmp/gamma",
      "~/src/alpha",
      "~/src/beta",
      "Other Locations",
    ]);
    expect(descending.map((group) => group.label)).toEqual([
      "~/src/beta",
      "~/src/alpha",
      "/tmp/gamma",
      "Other Locations",
    ]);
  });

  it("aggregates multiple projects that share the same project folder", () => {
    const groups = buildProjectFolderGroups(
      [
        ...projects,
        {
          id: "project_5",
          provider: "cursor" as const,
          name: "Alpha Two",
          path: "/Users/test/src/alpha",
          sessionCount: 4,
          messageCount: 18,
          bookmarkCount: 0,
          lastActivity: "2026-03-01T14:00:00.000Z",
        },
      ],
      "last_active",
      "desc",
    );

    const alphaGroup = groups.find((group) => group.label === "~/src/alpha");
    expect(alphaGroup).toMatchObject({
      projectCount: 2,
      sessionCount: 6,
      lastActivity: "2026-03-01T14:00:00.000Z",
    });
    expect(alphaGroup?.projects.map((project) => project.id)).toEqual(["project_1", "project_5"]);
  });
});
