import { describe, expect, it } from "vitest";

import { isSessionsPaneVisible } from "./historyPaneVisibility";

describe("historyPaneVisibility", () => {
  it("returns false when the sessions pane is collapsed", () => {
    expect(
      isSessionsPaneVisible({
        sessionPaneCollapsed: true,
        projectViewMode: "list",
        hideSessionsPaneForTreeView: false,
      }),
    ).toBe(false);
  });

  it("returns false when tree view hides the sessions pane", () => {
    expect(
      isSessionsPaneVisible({
        sessionPaneCollapsed: false,
        projectViewMode: "tree",
        hideSessionsPaneForTreeView: true,
      }),
    ).toBe(false);
  });

  it("returns true when the sessions pane is available", () => {
    expect(
      isSessionsPaneVisible({
        sessionPaneCollapsed: false,
        projectViewMode: "list",
        hideSessionsPaneForTreeView: false,
      }),
    ).toBe(true);
  });
});
