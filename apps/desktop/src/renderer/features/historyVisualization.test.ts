import { describe, expect, it } from "vitest";

import {
  deriveInitialHistoryVisualization,
  getTurnVisualizationSelection,
} from "./historyVisualization";

describe("deriveInitialHistoryVisualization", () => {
  it("defaults to Flat when pane state does not specify a history view", () => {
    expect(deriveInitialHistoryVisualization(null)).toBe("messages");
    expect(deriveInitialHistoryVisualization(undefined)).toBe("messages");
    expect(deriveInitialHistoryVisualization({} as never)).toBe("messages");
  });

  it("preserves legacy flat and bookmarks pane state hydration", () => {
    expect(
      deriveInitialHistoryVisualization({
        historyMode: "session",
        historyDetailMode: "flat",
      } as never),
    ).toBe("messages");
    expect(
      deriveInitialHistoryVisualization({
        historyMode: "bookmarks",
        historyDetailMode: "flat",
      } as never),
    ).toBe("bookmarks");
  });
});

describe("getTurnVisualizationSelection", () => {
  it("fills in a missing project id for project-wide selections from the selected project", () => {
    expect(
      getTurnVisualizationSelection({
        selection: {
          mode: "project_all",
          projectId: "",
        },
        selectedProjectId: "project_1",
      }),
    ).toEqual({
      mode: "project_all",
      projectId: "project_1",
    });
  });

  it("fills in a missing project id for bookmark selections before switching to turns", () => {
    expect(
      getTurnVisualizationSelection({
        selection: {
          mode: "bookmarks",
          projectId: "",
        },
        selectedProjectId: "project_1",
      }),
    ).toEqual({
      mode: "project_all",
      projectId: "project_1",
    });
  });

  it("keeps an unresolved selection unchanged when no fallback project is available", () => {
    expect(
      getTurnVisualizationSelection({
        selection: {
          mode: "project_all",
          projectId: "",
        },
        selectedProjectId: "",
      }),
    ).toEqual({
      mode: "project_all",
      projectId: "",
    });
  });
});
